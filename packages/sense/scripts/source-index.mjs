#!/usr/bin/env node

/**
 * What one source scan costs on somebody else's repository, and what changes it.
 *
 * The number that matters for this stage is not the cold build. It is what a run
 * costs when four files moved, because that is every run after the first, and it
 * is the number a person compares against how long their tests take. A stage
 * that rebuilds a repository to answer a question about a diff has a shape
 * problem, and a shape problem shows up here as a row that does not move when the
 * diff does.
 *
 * So each row below is one whole run — open the index, scan, publish — against a
 * working tree this script puts into a known state first. The edits are made and
 * reverted in the target repository, which must be clean before it starts.
 *
 * The tree is timed separately because it is git's, not ours: `ls-tree` reads the
 * commit and `status` reads the working tree, and only the second one scales with
 * the checkout. It is measured with and without `core.fsmonitor`, passed as `-c`
 * so that nothing in the target repository's configuration is changed.
 *
 * The floor is read and parse over the same files with nothing else happening.
 * Everything above it is ours, and naming it is the point: a scan that costs six
 * times its floor is not waiting on the parser.
 *
 * Run:  node packages/sense/scripts/source-index.mjs {MATERIAL-UI}
 *       node packages/sense/scripts/source-index.mjs <repository> packages docs/src
 */
import { execFile, execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { parseSync, rawTransferSupported } from 'oxc-parser';
import { scanRelations } from '../dist/scan.js';
import { openSourceIndex } from '../dist/source-index.js';

const run = promisify(execFile);
const REPO = process.argv[2];
if (REPO === undefined) {
  console.error('usage: node packages/sense/scripts/source-index.mjs <repository> [directories...]');
  process.exit(2);
}
const DIRS = process.argv.length > 3 ? process.argv.slice(3) : ['packages', 'docs/src'];
const MAX_OUTPUT = 256 * 1024 * 1024;
const git = { cwd: REPO, encoding: 'utf8', maxBuffer: MAX_OUTPUT };

if (execFileSync('git', ['status', '--porcelain'], git).trim() !== '') {
  console.error(`${REPO} has uncommitted changes; this script edits and reverts files in it`);
  process.exit(2);
}

const took = async (what) => {
  const from = process.hrtime.bigint();
  const answer = await what();
  return [Number(process.hrtime.bigint() - from) / 1e6, answer];
};
/** Median of five, because one timing of a 100 ms command is a coin toss. */
const median = async (what) => {
  const times = [];
  for (let trial = 0; trial < 5; trial += 1) times.push((await took(what))[0]);
  return times.sort((left, right) => left - right)[2];
};

const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], git).trim();
const tracked = execFileSync('git', ['ls-files'], git).split('\n').filter(Boolean);
console.log(`${REPO} at ${commit}: ${tracked.length} tracked paths, scanning ${DIRS.join(' ')}`);

const listing = ['ls-tree', '-r', '-z', 'HEAD'];
const status = ['status', '--porcelain=v1', '-z', '--untracked-files=all'];
const bytes = { cwd: REPO, encoding: 'buffer', maxBuffer: MAX_OUTPUT };
// One priming call so the daemon is running and the timing is of a warm watcher
// rather than of starting one.
await run('git', ['-c', 'core.fsmonitor=true', ...status], bytes);
const tree = {
  listing: await median(() => run('git', listing, bytes)),
  cold: await median(() => run('git', ['-c', 'core.fsmonitor=false', ...status], bytes)),
  watched: await median(() => run('git', ['-c', 'core.fsmonitor=true', ...status], bytes)),
};
await run('git', ['fsmonitor--daemon', 'stop'], git).catch(() => {});
console.log(
  `\nthe tree, which is git's\n` +
    `  ls-tree                    ${tree.listing.toFixed(0).padStart(5)} ms   the commit; does not move with the checkout\n` +
    `  status                     ${tree.cold.toFixed(0).padStart(5)} ms   the working tree\n` +
    `  status, core.fsmonitor     ${tree.watched.toFixed(0).padStart(5)} ms   the same answer from a watcher` +
    `  (${(tree.cold / tree.watched).toFixed(1)}x)`,
);

const MODULE = /\.(?:[cm]?[jt]sx?)$/;
const sources = execFileSync('git', ['ls-files', ...DIRS], git)
  .split('\n')
  .filter((file) => MODULE.test(file) && !file.endsWith('.d.ts'))
  .map((file) => [file, readFileSync(join(REPO, file), 'utf8')]);
const source = sources.reduce((sum, [, text]) => sum + Buffer.byteLength(text), 0);
const options = { experimentalRawTransfer: rawTransferSupported() };
const reading = await median(async () => {
  for (const [file] of sources) readFileSync(join(REPO, file));
});
const parsing = await median(async () => {
  for (const [file, text] of sources) parseSync(file, text, options);
});
console.log(
  `\nthe floor: ${sources.length} module files, ${(source / 1e6).toFixed(1)} MB of source\n` +
    `  read                       ${reading.toFixed(0).padStart(5)} ms\n` +
    `  oxc parse                  ${parsing.toFixed(0).padStart(5)} ms\n` +
    `  ${'—'.repeat(5)}\n` +
    `  what a scan cannot go below${(reading + parsing).toFixed(0).padStart(5)} ms`,
);

const directory = mkdtempSync(join(tmpdir(), 'va-source-index-'));
const index = join(directory, 'index.bin');
const held = () => {
  let total = statSync(index).size;
  for (const file of readdirSync(`${index}.segments`)) total += statSync(join(`${index}.segments`, file)).size;
  return total;
};

/** One whole run, reported the way a caller pays for it. */
async function scan(label) {
  const [opening, session] = await took(() => openSourceIndex(index));
  const [scanning, records] = await took(() =>
    scanRelations({ root: REPO, dirs: DIRS, cache: session.cache, reuse: session.reuse }),
  );
  const [saving] = await took(() => session.save());
  console.log(
    `  ${label.padEnd(24)}${(opening + scanning + saving).toFixed(0).padStart(5)} ms` +
      `   = open ${opening.toFixed(0)} + scan ${scanning.toFixed(0)} + publish ${saving.toFixed(0)}`,
  );
  return records.length;
}

console.log('\none whole run: open the index, scan, publish');
const records = await scan('cold, no index');
console.log(`  ${'—'.repeat(5)}  ${records} records, ${(held() / 1e6).toFixed(1)} MB on disk`);
await scan('nothing changed');

const edited = execFileSync('git', ['ls-files', ...DIRS], git)
  .split('\n')
  .filter((file) => MODULE.test(file) && !file.endsWith('.d.ts'))
  .slice(0, 4)
  .map((file) => [file, readFileSync(join(REPO, file), 'utf8')]);
for (const [file, text] of edited) writeFileSync(join(REPO, file), `${text}\n// edited by the benchmark\n`);
await scan('4 files edited');
for (const [file, text] of edited) writeFileSync(join(REPO, file), text);
await scan('the same 4 reverted');

const appeared = join(REPO, DIRS[0], '__benchmark-added.ts');
writeFileSync(appeared, 'export const added = 1;\n');
await scan('1 file added');
rmSync(appeared);
await scan('the same 1 removed');

rmSync(directory, { recursive: true, force: true });
