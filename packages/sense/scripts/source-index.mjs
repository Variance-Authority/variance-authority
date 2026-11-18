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
 * Source acquisition, parsing and publication remain native. Set
 * VARIANCE_SENSE_TIMINGS=1 to receive the native owner's phase timings on stderr.
 * The only source strings this driver holds are the bounded files it edits and
 * restores between update rows.
 *
 * Run:  node packages/sense/scripts/source-index.mjs {MATERIAL-UI}
 *       node packages/sense/scripts/source-index.mjs <repository> packages docs/src
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateSourceIndex } from '../dist/published.js';

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
const commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], git).trim();
const tracked = execFileSync('git', ['ls-files'], git).split('\n').filter(Boolean);
console.log(`${REPO} at ${commit}: ${tracked.length} tracked paths, scanning ${DIRS.join(' ')}`);

const MODULE = /\.(?:[cm]?[jt]sx?)$/;

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
  const [elapsed, update] = await took(() => updateSourceIndex(REPO, { index, dirs: DIRS }));
  if (update.refused !== undefined) throw new Error(update.refused);
  console.log(
    `  ${label.padEnd(31)}${elapsed.toFixed(0).padStart(5)} ms` +
      `\n  ${' '.repeat(31)}      ${update.files - update.reread} records reused, ${update.reread} rebuilt,` +
      ` of which ${update.parsed} parsed their bytes`,
  );
  return update.files;
}

console.log('\none whole run: open the index, scan, publish');
const records = await scan('cold, no index');
console.log(`  ${'—'.repeat(5)}  ${records} records, ${(held() / 1e6).toFixed(1)} MB on disk`);
await scan('nothing changed');

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
