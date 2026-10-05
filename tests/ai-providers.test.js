const test = require('node:test');
const assert = require('node:assert/strict');

const {
  listProviders, getAdapter, buildNoteTools,
  normaliseClaudeMessage, normaliseCopilotEvent,
} = require('../ai-providers');

// ── Provider detection ─────────────────────────────────────────────────────
test('listProviders reports both providers with a reason when unavailable', () => {
  const list = listProviders();
  assert.deepEqual(list.map(p => p.id).sort(), ['claude', 'copilot']);
  for (const p of list) {
    assert.equal(typeof p.available, 'boolean');
    if (!p.available) assert.ok(p.reason, `${p.id} must say why it is unavailable`);
  }
});

test('an unavailable provider degrades instead of throwing', () => {
  // The Copilot runtime does not exist on Linux, which is the whole mechanism by
  // which "work device only" is enforced -- it must report, not crash.
  const copilot = listProviders().find(p => p.id === 'copilot');
  assert.equal(copilot.available, process.platform === 'win32' ? copilot.available : false);
});

test('getAdapter rejects an unknown provider by name', () => {
  assert.throws(() => getAdapter('gemini'), /Unknown AI provider: gemini/);
});

// ── Note tools ─────────────────────────────────────────────────────────────
test('buildNoteTools exposes the documented set', () => {
  const names = buildNoteTools(() => {}).map(t => t.name);
  assert.deepEqual(names, [
    'list_notebooks', 'search_notes', 'read_note',
    'edit_note', 'append_to_note', 'create_note',
  ]);
});

test('allowWrites false yields only read tools', () => {
  const tools = buildNoteTools(() => {}, { allowWrites: false });
  assert.deepEqual(tools.map(t => t.name), ['list_notebooks', 'search_notes', 'read_note']);
  assert.ok(tools.every(t => t.readOnly), 'read-only tools must be annotated as such');
});

test('every tool declares its required arguments as a subset of its schema', () => {
  for (const tool of buildNoteTools(() => {})) {
    for (const key of tool.required || []) {
      assert.ok(key in tool.schema, `${tool.name}: required "${key}" is not in its schema`);
    }
  }
});

test('tool handlers forward name and arguments to the renderer', async () => {
  const calls = [];
  const tools = buildNoteTools(async (name, args) => { calls.push([name, args]); return 'ok'; });
  const read = tools.find(t => t.name === 'read_note');
  assert.equal(await read.run({ id: 'n1' }), 'ok');
  assert.deepEqual(calls, [['read_note', { id: 'n1' }]]);
});

// ── Claude event normalisation ─────────────────────────────────────────────
test('a Claude assistant message yields its text and tool names', () => {
  const out = normaliseClaudeMessage({
    type: 'assistant',
    message: { content: [
      { type: 'text', text: 'Hello' },
      { type: 'tool_use', name: 'mcp__notehub__read_note' },
      { type: 'text', text: ' there' },
    ] },
  });
  assert.equal(out.type, 'assistant');
  assert.equal(out.text, 'Hello there');
  assert.deepEqual(out.tools, ['mcp__notehub__read_note']);
});

test('a Claude result message ends the turn', () => {
  const out = normaliseClaudeMessage({ type: 'result', stop_reason: 'end_turn', result: 'x' });
  assert.equal(out.type, 'done');
});

test('an unknown Claude message does not crash the stream', () => {
  assert.equal(normaliseClaudeMessage({ type: 'something_new' }).type, 'raw');
  assert.equal(normaliseClaudeMessage({ type: 'assistant' }).text, '');
});

// ── Copilot event normalisation ────────────────────────────────────────────
//
// These names and shapes come from the SDK's generated/session-events.d.ts. The
// first version of this code guessed them and got every one wrong: payloads are
// nested under `data`, and the names are dot-namespaced ("assistant.message",
// not "assistant_message"). Reading event.text at the top level returned
// undefined, so the panel stayed empty with nothing logged to explain it.
test('a Copilot assistant message reads content from data', () => {
  const out = normaliseCopilotEvent({ type: 'assistant.message', data: { content: 'Hi' } });
  assert.deepEqual(out, { type: 'assistant', text: 'Hi', tools: [] });
});

test('a Copilot tool start reports toolName from data', () => {
  const out = normaliseCopilotEvent({ type: 'tool.execution_start', data: { toolName: 'search_notes' } });
  assert.deepEqual(out.tools, ['search_notes']);
});

test('every Copilot idle variant ends the turn', () => {
  for (const type of ['assistant.idle', 'assistant.turn_end', 'session.idle', 'agent_idle']) {
    assert.equal(normaliseCopilotEvent({ type, data: {} }).type, 'done', type);
  }
});

test('a Copilot session error surfaces its message', () => {
  assert.equal(normaliseCopilotEvent({ type: 'session.error', data: { message: 'boom' } }).text, 'boom');
  // The field name is not guaranteed across versions, so a fallback is checked.
  assert.ok(normaliseCopilotEvent({ type: 'session.error', data: {} }).text);
});

test('an abort ends the turn rather than looking like an error', () => {
  assert.equal(normaliseCopilotEvent({ type: 'abort', data: {} }).stopReason, 'aborted');
});

test('Copilot deltas are deliberately not treated as content', () => {
  // Mixing deltas with the complete assistant.message would print every answer
  // twice; the payloads share no id that makes correlating them reliable.
  assert.equal(normaliseCopilotEvent({ type: 'assistant.message_delta', data: { deltaContent: 'Hel' } }).type, 'raw');
});

test('a malformed Copilot event does not throw', () => {
  for (const event of [undefined, null, {}, { type: 'assistant.message' }]) {
    assert.doesNotThrow(() => normaliseCopilotEvent(event));
  }
  assert.equal(normaliseCopilotEvent({ type: 'assistant.message' }).text, '');
});
