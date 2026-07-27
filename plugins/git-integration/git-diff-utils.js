function parseUnifiedDiff(diffText) {
    if (!diffText) return [];
    const lines = diffText.split('\n');
    const hunkHeaderRe = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
    const hunks = [];
    let current = null;

    for (const line of lines) {
        const match = line.match(hunkHeaderRe);
        if (match) {
            current = {
                oldStart: parseInt(match[1], 10),
                oldLines: match[2] !== undefined ? parseInt(match[2], 10) : 1,
                newStart: parseInt(match[3], 10),
                newLines: match[4] !== undefined ? parseInt(match[4], 10) : 1,
                lines: [],
            };
            hunks.push(current);
            continue;
        }
        if (!current) continue;
        if (line.startsWith('+')) current.lines.push({ type: 'added', text: line.slice(1) });
        else if (line.startsWith('-')) current.lines.push({ type: 'removed', text: line.slice(1) });
        else if (line.startsWith(' ')) current.lines.push({ type: 'context', text: line.slice(1) });
    }
    return hunks;
}

function hunksToSideBySide(hunks) {
    const rows = [];
    for (const hunk of hunks) {
        const lines = hunk.lines;
        let i = 0;
        while (i < lines.length) {
            if (lines[i].type === 'context') {
                rows.push({ left: { ...lines[i] }, right: { ...lines[i] } });
                i++;
                continue;
            }
            const removedRun = [];
            while (i < lines.length && lines[i].type === 'removed') { removedRun.push(lines[i]); i++; }
            const addedRun = [];
            while (i < lines.length && lines[i].type === 'added') { addedRun.push(lines[i]); i++; }
            const maxLen = Math.max(removedRun.length, addedRun.length);
            for (let j = 0; j < maxLen; j++) {
                rows.push({
                    left: removedRun[j] ? { ...removedRun[j] } : null,
                    right: addedRun[j] ? { ...addedRun[j] } : null,
                });
            }
        }
    }
    return rows;
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseUnifiedDiff, hunksToSideBySide };
}
