// Unified diff reading shared by the Phase 0 scripts.

/** A line that carries no code: blank, or inside a comment by its own opening. */
const isProse = (text) => /^\s*(\/\/|\/\*|\*|$)/.test(text);

/**
 * Changed old-side lines, old-side insertion points, and the same for the new side, per file.
 * `oldCode` and `oldCodeInserts` are the subsets that carry code, not comments or blanks.
 */
export function parseDiff(patch) {
  const files = new Map();
  let cur = null;
  let oldLine = 0;
  let newLine = 0;
  for (const line of patch.split('\n')) {
    if (line.startsWith('diff --git ')) {
      const m = / b\/(.*)$/.exec(line);
      cur = { path: m[1], oldPath: / a\/(.*) b\//.exec(line)[1], oldLines: new Set(), oldInserts: new Set(), newLines: new Set(), newInserts: new Set(), oldCode: new Set(), oldCodeInserts: new Set(), added: false, deleted: false };
      files.set(cur.path, cur);
      continue;
    }
    if (!cur) continue;
    if (line.startsWith('new file mode')) cur.added = true;
    else if (line.startsWith('deleted file mode')) cur.deleted = true;
    else if (line.startsWith('@@')) {
      const m = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
      oldLine = Number(m[1]);
      newLine = Number(m[2]);
      // A zero-length side starts one line early in unified diff notation.
      if (/^@@ -\d+,0 /.test(line)) oldLine += 1;
      if (/ \+\d+,0 @@/.test(line)) newLine += 1;
    } else if (line.startsWith('---') || line.startsWith('+++')) continue;
    else if (line.startsWith('-')) {
      if (!isProse(line.slice(1))) cur.oldCode.add(oldLine);
      cur.oldLines.add(oldLine++);
      cur.newInserts.add(newLine);
    } else if (line.startsWith('+')) {
      cur.newLines.add(newLine++);
      cur.oldInserts.add(oldLine);
      if (!isProse(line.slice(1))) cur.oldCodeInserts.add(oldLine);
    } else if (line.startsWith(' ')) {
      oldLine++;
      newLine++;
    }
  }
  return files;
}
