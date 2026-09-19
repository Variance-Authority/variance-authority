#!/usr/bin/env node

/**
 * How many threads may be inside the filesystem at once, and what decides it.
 *
 * The scanner reads at one width and parses at another, and the read width is a
 * constant — `READERS` in `native/src/batch.rs`. A constant invites the question
 * this script exists to answer: whether it should instead scale with the size of
 * the job, more files earning more threads the way more work usually does.
 *
 * It should not, and the two tables say why in different ways.
 *
 * The first sweeps width against file count by taking prefixes of one
 * repository's file list, which holds the filesystem, the directory shape and
 * the file-size distribution still so that the only thing moving between rows is
 * how many files are opened. The best width does not move with the count.
 *
 * The second sweeps width against processor time on the whole list, split into
 * user and system. It reports what one `open` costs the kernel, which is the
 * mechanism: the work does not get slower, the syscalls do, and they get slower
 * because of each other. Saturation would hold that number flat and flatten the
 * wall clock. Contention raises it, and past the ceiling sixteen threads finish
 * a large repository later than one does.
 *
 * What that ceiling is belongs to the machine — its filesystem, and how many
 * threads that filesystem lets into a path lookup at once. It is worth
 * re-running here before trusting the constant on a kernel or a mount this
 * project has not measured.
 *
 * The page cache is warmed first, deliberately: it separates the cost of the
 * syscall from the cost of the disk, and it is the pessimistic case for
 * threading, because extra threads have no I/O latency left to hide behind.
 *
 * ```sh
 * node packages/sense/scripts/read-width.mjs --root ~/dev/material-ui
 * node packages/sense/scripts/read-width.mjs --root . --repeat 5
 * ```
 */

import { execFile } from 'node:child_process';
import { cpuUsage } from 'node:process';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { MODULE_EXTENSIONS } from '../dist/read.js';
import { native } from '../dist/native.js';

const run = promisify(execFile);

/** Every file, however large: both widths must be given the same bytes. */
const NO_CAP = 0xffffffff;

/** Widths worth asking about — one, the ceiling, and the collapse past it. */
const WIDTHS = [1, 2, 3, 4, 6, 8, 12, 16];

const argued = new Map();
for (let at = 2; at < process.argv.length; at += 2) {
  argued.set(process.argv[at].replace(/^--/u, ''), process.argv[at + 1]);
}

const root = resolve(argued.get('root') ?? '.');
const repeat = Number(argued.get('repeat') ?? 3);
const addon = native();
if (addon === undefined) {
  console.error('no native scanner built — run `node native/build.mjs` first');
  process.exit(1);
}

const { stdout } = await run('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 1 << 28 });
const files = stdout
  .split('\0')
  .filter((path) => path !== '' && MODULE_EXTENSIONS.some((end) => path.endsWith(end)));

if (files.length === 0) {
  console.error(`no module files under ${root}`);
  process.exit(1);
}

// Warm the page cache, so what follows measures syscalls rather than the disk.
addon.readBatch(root, files, NO_CAP, false, 6);

console.log(`${root}\n${files.length} module files, best of ${repeat}\n`);

/** One batch at one width, taking the best of `repeat` as the machine's answer. */
function best(at, width) {
  let held;
  for (let attempt = 0; attempt < repeat; attempt += 1) {
    const before = cpuUsage();
    const started = process.hrtime.bigint();
    addon.readBatch(root, at, NO_CAP, false, width);
    const ms = Number(process.hrtime.bigint() - started) / 1e6;
    const spent = cpuUsage(before);
    if (held === undefined || ms < held.ms) {
      held = { ms, user: spent.user / 1000, system: spent.system / 1000 };
    }
  }

  return held;
}

// Prefixes rather than separate repositories: one file list sliced is the same
// filesystem asked the same question about more of itself.
const sizes = [];
for (let size = 125; size < files.length; size *= 2) sizes.push(size);
sizes.push(files.length);

console.log('the best width, against how many files are opened\n');
console.log(['files'.padStart(7), ...WIDTHS.map((width) => String(width).padStart(7))].join('') + '   best');
for (const size of sizes) {
  const row = WIDTHS.map((width) => best(files.slice(0, size), width).ms);
  const won = WIDTHS[row.indexOf(Math.min(...row))];
  console.log(
    [String(size).padStart(7), ...row.map((ms) => ms.toFixed(1).padStart(7))].join('') +
      `   ${String(won).padStart(2)}`,
  );
}

console.log('\nwhere the time goes, over every file\n');
console.log('width       ms     user ms   system ms   cores   kernel µs/file');
for (const width of WIDTHS) {
  const held = best(files, width);
  console.log(
    String(width).padStart(5) +
      held.ms.toFixed(1).padStart(9) +
      held.user.toFixed(0).padStart(12) +
      held.system.toFixed(0).padStart(12) +
      ((held.user + held.system) / held.ms).toFixed(1).padStart(8) +
      ((held.system * 1000) / files.length).toFixed(1).padStart(17),
  );
}
