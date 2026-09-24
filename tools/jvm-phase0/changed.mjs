// Prints each changed main-source Java file of a diff as `new path<TAB>old path<TAB>new-side lines csv`.
// Usage: node changed.mjs <diff.patch> [test source root]
import { readFileSync } from 'node:fs';
import { parseDiff } from './diff.mjs';

const [patch, testRoot = 'src/test/java'] = process.argv.slice(2);
for (const f of parseDiff(readFileSync(patch, 'utf8')).values()) {
  if (!f.path.endsWith('.java') || f.path.startsWith(testRoot + '/') || f.deleted) continue;
  console.log(`${f.path}\t${f.added ? '' : f.oldPath}\t${[...f.newLines].join(',')}`);
}
