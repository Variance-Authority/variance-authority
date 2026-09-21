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
 * the checkout. Two accelerators are measured because neither one answers the
 * whole question: `core.fsmonitor` tells git which tracked files moved, and
 * `core.untrackedCache` is what spares it the walk for everything else. Both are
 * passed as `-c` so that nothing in the target repository's configuration is
 * changed.
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
import { readSourceIndex } from '../dist/source-index-file.js';

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
const off = ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false'];
const on = ['-c', 'core.fsmonitor=true'];
const tree = {
  listing: await median(() => run('git', listing, bytes)),
  cold: await median(() => run('git', [...off, ...status], bytes)),
  watched: await median(() => run('git', [...on, '-c', 'core.untrackedCache=false', ...status], bytes)),
  cached: await median(() => run('git', [...on, '-c', 'core.untrackedCache=true', ...status], bytes)),
};
await run('git', ['fsmonitor--daemon', 'stop'], git).catch(() => {});
console.log(
  `\nthe tree, which is git's\n` +
    `  ls-tree                    ${tree.listing.toFixed(0).padStart(5)} ms   the commit; does not move with the checkout\n` +
    `  status                     ${tree.cold.toFixed(0).padStart(5)} ms   the working tree\n` +
    `  status, fsmonitor          ${tree.watched.toFixed(0).padStart(5)} ms   tracked files answered by a watcher` +
    `  (${(tree.cold / tree.watched).toFixed(1)}x)\n` +
    `  status, and untrackedCache ${tree.cached.toFixed(0).padStart(5)} ms   the untracked walk cached too` +
    `  (${(tree.cold / tree.cached).toFixed(1)}x)`,
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

/**
 * One whole run, reported the way a caller pays for it — and counted.
 *
 * The timing alone does not say why a row is the size it is, and the two
 * plausible readings of a slow row are opposite: a scan that re-read the
 * repository, or a scan that reused everything and spent the time deciding to.
 * The counters separate them. A record is either reused or rebuilt, and a
 * rebuild either re-parses the file or answers from the content-keyed cache,
 * which is the difference between a repository read again and a repository
 * merely walked again.
 */
async function scan(label) {
  const [opening, session] = await took(() => openSourceIndex(index));
  const counted = { reused: 0, rebuilt: 0, parsed: 0 };
  // Counted on the session's own objects, in place, because the parse cache is
  // a WeakMap key. `adoptNativeParses` registers the native parse generation
  // against the object the scan was handed, and `save` looks it up against the
  // one the session closed over. An `Object.create` delegate answers every call
  // correctly and is a different key, so the generation was registered against
  // the wrapper and never published: this script reported a 4.9 MB index for a
  // repository whose index is 10.5 MB, and nothing failed to make it say so. A
  // delegate is not the object, and a wrapper is only safe where identity is
  // not the interface.
  //
  // Only the rare doors are counted. A counter on `get` sits on the hottest path
  // there is and reads 130 ms onto the row it is there to explain.
  const { cache, reuse } = session;
  const store = cache.set.bind(cache);
  cache.set = (key, parsed) => {
    counted.parsed += 1;
    store(key, parsed);
  };
  const indexed = reuse.getIndexed.bind(reuse);
  reuse.getIndexed = (file, digest) => {
    const record = indexed(file, digest);
    counted[record === undefined ? 'rebuilt' : 'reused'] += 1;

    return record;
  };
  const [scanning, records] = await took(() => scanRelations({ root: REPO, dirs: DIRS, cache, reuse }));
  const [saving] = await took(() => session.save());
  console.log(
    `  ${label.padEnd(31)}${(opening + scanning + saving).toFixed(0).padStart(5)} ms` +
      `   = open ${opening.toFixed(0)} + scan ${scanning.toFixed(0)} + publish ${saving.toFixed(0)}` +
      `\n  ${' '.repeat(31)}      ${counted.reused} records reused, ${counted.rebuilt} rebuilt,` +
      ` of which ${counted.parsed} opened the file`,
  );
  return records.length;
}

console.log('\none whole run: open the index, scan, publish');
const records = await scan('cold, no index');
console.log(`  ${'—'.repeat(5)}  ${records} records, ${(held() / 1e6).toFixed(1)} MB on disk`);
await scan('nothing changed');

/**
 * What one added path costs, which is a property of the directory it lands in.
 *
 * A record is invalidated by the directories its own specifiers could have been
 * answered from, so the blast radius of an appearance is the number of records
 * witnessing that one directory. A single row of the table below is one
 * repository's answer; the distribution is the claim. The tail is the part worth
 * reading: a directory a barrel imports from is watched by everything that
 * imports the barrel.
 */
const stored = await readSourceIndex(index);
const watchers = new Map();
let entries = 0;
for (const [, held] of stored.records) {
  for (const directory of held.witnesses) watchers.set(directory, (watchers.get(directory) ?? 0) + 1);
  entries += held.witnesses.length;
}
const fan = [...watchers.values()].sort((left, right) => left - right);
const quantile = (at) => fan[Math.min(fan.length - 1, Math.floor(fan.length * at))];
const widest = [...watchers].sort((left, right) => right[1] - left[1])[0];
console.log(
  `\nwhat one added path costs: ${stored.directories.size} directories, ${watchers.size} of them witnessed` +
    `, ${entries} witness entries (${(entries / stored.records.size).toFixed(1)} per record)\n` +
    `  records rebuilt      median ${quantile(0.5)}   p90 ${quantile(0.9)}` +
    `   p99 ${quantile(0.99)}   max ${widest[1]}\n` +
    `  the widest directory  ${widest[0] || '<root>'}`,
);

/**
 * A working tree put into a stated shape, and put back.
 *
 * Every file it touches is read first and written back from memory, so the
 * repository ends where it started without anything being asked of git — which
 * matters because the thing being measured is what git says about the tree.
 * Removals are moved aside rather than deleted for the same reason.
 */
const modules = execFileSync('git', ['ls-files', ...DIRS], git)
  .split('\n')
  .filter((file) => MODULE.test(file) && !file.endsWith('.d.ts'));

async function diff(label, { edit = 0, remove = 0, add = 0 }) {
  const editing = modules.slice(0, edit).map((file) => [file, readFileSync(join(REPO, file), 'utf8')]);
  const removing = modules.slice(-remove || modules.length).map((file) => [file, readFileSync(join(REPO, file), 'utf8')]);
  const adding = Array.from({ length: add }, (_, at) => join(REPO, DIRS[0], `__benchmark-${at}.ts`));

  for (const [file, text] of editing) writeFileSync(join(REPO, file), `${text}\n// edited by the benchmark\n`);
  if (remove > 0) for (const [file] of removing) rmSync(join(REPO, file));
  for (const file of adding) writeFileSync(file, 'export const added = 1;\n');
  try {
    await scan(label);
  } finally {
    for (const [file, text] of editing) writeFileSync(join(REPO, file), text);
    if (remove > 0) for (const [file, text] of removing) writeFileSync(join(REPO, file), text);
    for (const file of adding) rmSync(file);
  }
}

await diff('4 files edited', { edit: 4 });
await scan('the same 4 reverted');
await diff('500 files edited', { edit: 500 });
await scan('the same 500 reverted');
await diff('1 file added', { add: 1 });
await scan('the same 1 removed');
await diff('100 in, 100 out, 500 edited', { add: 100, remove: 100, edit: 500 });
await scan('all of that reverted');

rmSync(directory, { recursive: true, force: true });
