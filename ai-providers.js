/* NoteHub — AI providers (main process only).
 *
 * Two assistants, one interface:
 *
 *   claude   @anthropic-ai/claude-agent-sdk -> spawns the local Claude Code
 *            binary, which authenticates from ~/.claude. No ANTHROPIC_API_KEY,
 *            and no second bill: a Claude Pro/Max subscription does not grant
 *            Messages API access, so going through Claude Code is what makes
 *            "use my subscription" true rather than approximately true.
 *
 *   copilot  @github/copilot-sdk -> JSON-RPC to the locally installed GitHub
 *            Copilot CLI, which carries whatever account already authorised it.
 *            That is why Copilot needs no device check: the adapter is
 *            unavailable wherever the runtime is not installed, which is
 *            exactly "the work machine only".
 *
 * Everything here runs in the main process. Both SDKs spawn child processes and
 * speak JSON-RPC, neither can be reached from a renderer with
 * contextIsolation: true, and that boundary is not negotiable in this app.
 *
 * Both are required lazily inside try/catch. A missing or broken SDK has to
 * degrade to "provider unavailable" rather than take the app down on launch --
 * the Copilot runtime genuinely does not exist on most machines.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

// require() failures carry the whole require stack. Only the first line is
// useful in a status string the user will read.
function firstLine(message) {
    return String(message || '').split('\n')[0].trim();
}

// ── Note tools ─────────────────────────────────────────────────────────────
//
// The agent never touches notebooks.json. It cannot safely: notes are records
// inside a single blob that the *renderer* holds in memory and flushes every
// two seconds, so a write from this process would either be clobbered by the
// next autosave or clobber the user's typing, depending on timing. It would
// also bypass writeFileDurable() and pushHistoryVersion().
//
// So every note tool is proxied to the renderer, which owns the live state and
// applies the change through its own save path. Two things fall out of that:
// writes stay atomic and backed up, and every edit the agent makes becomes one
// of the note's 50 history snapshots -- which means anything the AI does to a
// note is undoable through a UI that already exists.
//
// `invokeRenderer` is injected so this module stays testable without Electron.
function buildNoteTools(invokeRenderer, { allowWrites = true } = {}) {
    const tools = [
        {
            name: 'list_notebooks',
            description: 'List the notebooks, with the number of notes in each.',
            readOnly: true,
            schema: {},
            run: () => invokeRenderer('list_notebooks', {}),
        },
        {
            name: 'search_notes',
            description:
                'Search note titles and bodies. Returns matching notes as ' +
                '{ id, title, notebook, tags, snippet }. Use this before asking the ' +
                'user where something is.',
            readOnly: true,
            schema: {
                query: { type: 'string', description: 'Text to search for' },
                limit: { type: 'number', description: 'Max results (default 20)' },
            },
            required: ['query'],
            run: (args) => invokeRenderer('search_notes', args),
        },
        {
            name: 'read_note',
            description: 'Read one note\'s full markdown by id. Use search_notes to find the id.',
            readOnly: true,
            schema: { id: { type: 'string', description: 'Note id' } },
            required: ['id'],
            run: (args) => invokeRenderer('read_note', args),
        },
    ];

    if (!allowWrites) return tools;

    return tools.concat([
        {
            name: 'edit_note',
            description:
                'Replace a note\'s markdown body. The previous content is kept as a ' +
                'restorable version, so this is reversible. Send the complete new body, ' +
                'not a patch.',
            schema: {
                id: { type: 'string', description: 'Note id' },
                content: { type: 'string', description: 'The complete new markdown body' },
            },
            required: ['id', 'content'],
            run: (args) => invokeRenderer('edit_note', args),
        },
        {
            name: 'append_to_note',
            description:
                'Append markdown to the end of a note. Preferred over edit_note when ' +
                'adding to a note, because it cannot accidentally drop existing content.',
            schema: {
                id: { type: 'string', description: 'Note id' },
                markdown: { type: 'string', description: 'Markdown to append' },
            },
            required: ['id', 'markdown'],
            run: (args) => invokeRenderer('append_to_note', args),
        },
        {
            name: 'create_note',
            description: 'Create a new note in a notebook and return its id.',
            schema: {
                title: { type: 'string', description: 'Note title' },
                content: { type: 'string', description: 'Markdown body' },
                notebookId: {
                    type: 'string',
                    description: 'Notebook id; defaults to the one currently open',
                },
            },
            required: ['title', 'content'],
            run: (args) => invokeRenderer('create_note', args),
        },
    ]);
}

// ── Claude ─────────────────────────────────────────────────────────────────

function claudeExecutableCandidates() {
    const home = os.homedir();
    return [
        path.join(home, '.local', 'bin', process.platform === 'win32' ? 'claude.exe' : 'claude'),
        path.join(home, '.claude', 'local', 'claude'),
    ];
}

// The SDK ships platform binaries as optional dependencies. When a package
// manager skips them (common behind a proxy, and electron-builder prunes
// aggressively) it needs to be pointed at an installed claude instead, so look
// one up rather than assuming the bundled path survived packaging.
function findClaudeExecutable() {
    for (const candidate of claudeExecutableCandidates()) {
        try {
            if (fs.existsSync(candidate)) return candidate;
        } catch { /* unreadable path is simply not a candidate */ }
    }
    return undefined;
}

function loadClaudeSdk() {
    try {
        // eslint-disable-next-line global-require
        return require('@anthropic-ai/claude-agent-sdk');
    } catch (err) {
        return { __error: firstLine(err.message) };
    }
}

const claudeAdapter = {
    id: 'claude',
    label: 'Claude',

    status() {
        const sdk = loadClaudeSdk();
        if (sdk.__error) {
            return { available: false, reason: `SDK not installed (${sdk.__error})` };
        }
        // Authentication lives in ~/.claude and is Claude Code's business, not
        // ours -- we deliberately do not read its credential files. If the user
        // is not logged in, the first query reports it and we surface that.
        const claudeDir = path.join(os.homedir(), '.claude');
        const looksAuthed = fs.existsSync(claudeDir);
        return {
            available: true,
            reason: looksAuthed ? null : 'Claude Code may not be signed in — run `claude` once',
            executable: findClaudeExecutable() || '(bundled)',
        };
    },

    // Returns { send, abort } and streams events through onEvent.
    async createSession({ tools, allowFileTools, cwd, model, onEvent }) {
        const sdk = loadClaudeSdk();
        if (sdk.__error) throw new Error(`Claude SDK unavailable: ${sdk.__error}`);

        const { query, tool, createSdkMcpServer } = sdk;
        const { z } = require('zod');

        // JSON-schema-ish descriptors -> zod, so the tool list is declared once
        // and both providers consume the same definitions.
        const zodShape = (t) => {
            const shape = {};
            for (const [key, spec] of Object.entries(t.schema || {})) {
                let field = spec.type === 'number' ? z.number() : z.string();
                if (spec.description) field = field.describe(spec.description);
                if (!(t.required || []).includes(key)) field = field.optional();
                shape[key] = field;
            }
            return shape;
        };

        const noteServer = createSdkMcpServer({
            name: 'notehub',
            version: '1.0.0',
            instructions:
                'Tools for reading and editing the user\'s notes. Prefer these over any ' +
                'filesystem tool: notes are records in a single data file, not files on ' +
                'disk, and these go through the app so every edit is undoable.',
            tools: (tools || []).map((t) =>
                tool(
                    t.name,
                    t.description,
                    zodShape(t),
                    async (args) => {
                        const result = await t.run(args);
                        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
                    },
                    { annotations: { readOnlyHint: !!t.readOnly } },
                ),
            ),
        });

        // The filesystem tools are off unless explicitly enabled. Enforced here
        // in canUseTool rather than through a permissionMode string, because the
        // decision depends on our own setting and we want it in one readable
        // place that also logs what was blocked.
        const FILE_TOOLS = ['Bash', 'Read', 'Write', 'Edit', 'Glob', 'Grep', 'WebFetch', 'WebSearch'];
        const canUseTool = async (toolName) => {
            if (toolName.startsWith('mcp__notehub__')) return { behavior: 'allow' };
            if (allowFileTools) return { behavior: 'allow' };
            if (FILE_TOOLS.some((t) => toolName === t || toolName.startsWith(`${t}(`))) {
                onEvent({ type: 'tool-blocked', tool: toolName });
                return {
                    behavior: 'deny',
                    message:
                        'Filesystem and shell tools are disabled. Use the notehub note tools ' +
                        'instead, or tell the user to enable file tools in Preferences.',
                };
            }
            return { behavior: 'allow' };
        };

        const executable = findClaudeExecutable();

        // One long-lived query, fed by a streaming input queue -- not a fresh
        // query() per message.
        //
        // query({ prompt: "..." }) is one-shot: calling it again starts a new
        // conversation with no memory of the previous turn, which in a chat panel
        // means the assistant forgets what it just said. The documented way to
        // hold a session open is an AsyncIterable prompt, so messages are pushed
        // into a queue the generator drains. It also means the Claude Code process
        // spawns once for the session rather than once per message.
        const queue = [];
        let wake = null;
        let closed = false;

        async function* prompts() {
            while (!closed) {
                if (queue.length) {
                    yield queue.shift();
                    continue;
                }
                await new Promise((resolve) => { wake = resolve; });
            }
        }

        const q = query({
            prompt: prompts(),
            options: {
                cwd,
                model,
                mcpServers: {
                    notehub: { type: 'sdk', name: 'notehub', instance: noteServer },
                },
                disallowedTools: allowFileTools ? [] : FILE_TOOLS,
                canUseTool,
                ...(executable ? { pathToClaudeCodeExecutable: executable } : {}),
            },
        });

        // Drained in the background for the session's lifetime. send() returns as
        // soon as the message is queued; completion reaches the renderer as a
        // 'done' event, which is what both surfaces already wait for.
        (async () => {
            try {
                for await (const message of q) {
                    onEvent(normaliseClaudeMessage(message));
                }
            } catch (err) {
                if (!closed) onEvent({ type: 'error', text: err.message });
            }
        })();

        return {
            async send(prompt) {
                queue.push({
                    type: 'user',
                    message: { role: 'user', content: prompt },
                    parent_tool_use_id: null,
                });
                if (wake) { const resume = wake; wake = null; resume(); }
            },
            async abort() {
                if (q.interrupt) {
                    try { await q.interrupt(); } catch { /* nothing running */ }
                }
            },
            async dispose() {
                closed = true;
                // Release the generator so the for-await loop can finish instead
                // of leaving the child process held open.
                if (wake) { const resume = wake; wake = null; resume(); }
                if (q.close) { try { await q.close(); } catch { /* already gone */ } }
            },
        };
    },
};

// One event shape for the renderer, whichever provider produced it, so the UI
// never branches on provider.
function normaliseClaudeMessage(message) {
    switch (message.type) {
        case 'assistant': {
            const blocks = (message.message && message.message.content) || [];
            const text = blocks.filter((b) => b.type === 'text').map((b) => b.text).join('');
            const toolUses = blocks.filter((b) => b.type === 'tool_use').map((b) => b.name);
            return { type: 'assistant', text, tools: toolUses };
        }
        case 'result':
            return { type: 'done', stopReason: message.stop_reason, result: message.result };
        case 'status':
            return { type: 'status', text: message.status || '' };
        default:
            return { type: 'raw', kind: message.type };
    }
}

// ── Copilot ────────────────────────────────────────────────────────────────

function copilotRuntimeDir() {
    if (process.platform !== 'win32') return null;
    const local = process.env.LOCALAPPDATA ||
        path.join(os.homedir(), 'AppData', 'Local');
    return path.join(local, 'Programs', 'GitHub Copilot');
}

function loadCopilotSdk() {
    try {
        // eslint-disable-next-line global-require
        return require('@github/copilot-sdk');
    } catch (err) {
        return { __error: firstLine(err.message) };
    }
}

const copilotAdapter = {
    id: 'copilot',
    label: 'GitHub Copilot',

    status() {
        const dir = copilotRuntimeDir();
        if (!dir || !fs.existsSync(dir)) {
            return {
                available: false,
                reason: 'GitHub Copilot is not installed on this machine',
            };
        }
        const sdk = loadCopilotSdk();
        if (sdk.__error) {
            return { available: false, reason: `SDK not installed (${sdk.__error})` };
        }
        return { available: true, reason: null, runtime: dir };
    },

    async createSession({ tools, cwd, model, onEvent }) {
        const sdk = loadCopilotSdk();
        if (sdk.__error) throw new Error(`Copilot SDK unavailable: ${sdk.__error}`);

        const { CopilotClient, defineTool } = sdk;

        // stdio, not the experimental in-process FFI transport: FFI would pull a
        // native library into the Electron bundle, which is a packaging and
        // ABI-matching problem we have no reason to take on.
        const client = new CopilotClient({ connection: { kind: 'stdio' } });
        await client.start();

        const auth = await client.getAuthStatus();
        if (!auth.isAuthenticated) {
            await client.stop();
            throw new Error(
                `GitHub Copilot is not signed in${auth.statusMessage ? `: ${auth.statusMessage}` : ''}`,
            );
        }
        onEvent({ type: 'status', text: `Copilot signed in as ${auth.login || 'unknown'}` });

        const session = await client.createSession({
            clientName: 'NoteHub',
            ...(model ? { model } : {}),
            ...(cwd ? { cwd } : {}),
            tools: (tools || []).map((t) =>
                defineTool({
                    name: t.name,
                    description: t.description,
                    parameters: {
                        type: 'object',
                        properties: t.schema || {},
                        required: t.required || [],
                    },
                    handler: async (args) => JSON.stringify(await t.run(args)),
                }),
            ),
        });

        const off = session.on((event) => onEvent(normaliseCopilotEvent(event)));

        return {
            async send(prompt) {
                await session.send(prompt);
            },
            async abort() {
                try { await session.abort(); } catch { /* already finished */ }
            },
            async dispose() {
                try { off(); } catch { /* handler already detached */ }
                try { await session.disconnect(); } catch { /* already gone */ }
                try { await client.stop(); } catch { /* already stopped */ }
            },
        };
    },
};

// Event names and payload shapes taken from the SDK's own
// generated/session-events.d.ts, not guessed. Two things there are easy to get
// wrong and silent when you do:
//
//   - every payload is nested under `data`. Reading event.text or event.content
//     at the top level yields undefined, so the panel stays empty with no error.
//   - the names are dot-namespaced: "assistant.message", not "assistant_message".
//
// Only assistant.message is used for content, not assistant.message_delta.
// Each assistant.message carries the complete `content` for that message and a
// turn may contain several (around tool calls), so appending them is correct and
// needs no correlation. Mixing in deltas would mean matching each delta's
// messageId against the final message to avoid printing the text twice, and the
// payloads do not share an id field that makes that reliable. Given a turn takes
// seconds anyway, losing token-level streaming costs little; printing every
// answer twice would not.
function normaliseCopilotEvent(event) {
    const type = event && event.type;
    const data = (event && event.data) || {};

    switch (type) {
        case 'assistant.message':
            return { type: 'assistant', text: data.content || '', tools: [] };

        case 'tool.execution_start':
            return { type: 'assistant', text: '', tools: [data.toolName || 'tool'] };

        // assistant.idle fires when the agent's loop goes idle even with
        // background work outstanding; session.idle is the session-level one.
        // Either means this turn has stopped producing output.
        case 'assistant.idle':
        case 'assistant.turn_end':
        case 'session.idle':
        case 'agent_idle':
            return { type: 'done', stopReason: 'end_turn' };

        case 'session.error':
            return { type: 'error', text: data.message || data.error || 'session error' };

        case 'session.warning':
            return { type: 'status', text: data.message || 'warning' };

        case 'abort':
            return { type: 'done', stopReason: 'aborted' };

        default:
            return { type: 'raw', kind: String(type || 'unknown') };
    }
}

// ── Registry ───────────────────────────────────────────────────────────────

const ADAPTERS = { claude: claudeAdapter, copilot: copilotAdapter };

function listProviders() {
    return Object.values(ADAPTERS).map((a) => {
        let status;
        try {
            status = a.status();
        } catch (err) {
            status = { available: false, reason: err.message };
        }
        return { id: a.id, label: a.label, ...status };
    });
}

function getAdapter(id) {
    const adapter = ADAPTERS[id];
    if (!adapter) throw new Error(`Unknown AI provider: ${id}`);
    return adapter;
}

module.exports = {
    listProviders,
    getAdapter,
    buildNoteTools,
    findClaudeExecutable,
    copilotRuntimeDir,
    normaliseClaudeMessage,
    normaliseCopilotEvent,
};
