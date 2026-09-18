#!/usr/bin/env node

/**
 * This scanner against ripgrep, over the same files, at the same widths.
 *
 * The comparison is worth making because the two programs do nearly the same
 * thing: walk a repository's source files, open every one, read all its bytes,
 * and reduce them to something much smaller. ripgrep then runs a literal search
 * over those bytes; this scanner parses them and extracts every specifier. So
 * ripgrep is doing strictly *less* work per byte, by a wide margin, and it has
 * had far more optimization attention than anything here ever will. It is the
 * floor — if this stage sits near it, the remaining cost is not ours to remove.
 *
 * The pattern given to ripgrep never matches, which is its best case: the
 * literal prefilter rejects each buffer without the regex engine ever running.
 * What is left is acquisition, which is the thing being measured.
 *
 * Both sides are swept across thread counts rather than run at one, because the
 * finding this script exists to record is that the curve has a minimum in the
 * middle and that both programs share it.
 *
 * ```sh
 * node scripts/scan-cost.mjs --root ~/dev/material-ui
 * ```
 */

import { execFile, spawnSync } from 'node:child_process';
import { cpuUsage } from 'node:process';
import { cpus } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { native } from '../dist/native.js';

const MODULES = /\.(m|c)?[jt]sx?$/u;
const GLOB = '*.{js,jsx,ts,tsx,mjs,cjs,mts,cts}';
/** Never present in source, so ripgrep rejects every buffer on the prefilter. */
const ABSENT = 'zzzznevermatchzzz';
/** No cap, so both sides read the same bytes. */
const EVERYTHING = 0xffffffff;

const argued = new Map();
for (let at = 2; at < process.argv.length; at += 2) {
  argued.set(process.argv[at].replace(/^--/u, ''), process.argv[at + 1]);
}
const root = resolve(argued.get('root') ?? '.');
const repeat = Number(argued.get('repeat') ?? 3);
const widths = [1, 2, 4, 6, 8, cpus().length];

// A child process per width: Rayon reads its pool size from the environment
// once, so a width cannot be changed inside a process that has already scanned.
if (process.env.VA_SCAN_WIDTH !== undefined) {
  const width = Number(process.env.VA_SCAN_WIDTH);
  const files = await modules(root);
  const addon = native();
  const cpu = cpuUsage();
  const at = process.hrtime.bigint();
  const read = addon.readBatch(root, files, EVERYTHING, false, width);
  const ms = Number(process.hrtime.bigint() - at) / 1e6;
  const spent = cpuUsage(cpu);
  process.stdout.write(
    JSON.stringify({ ms, user: spent.user / 1000, system: spent.system / 1000, requests: read.values.length }),
  );
  process.exit(0);
}

const rg = which();
const files = await modules(root);
const seen = rg === undefined
  ? 0
  : spawnSync(rg, ['--files', '-g', GLOB, '.'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
      .stdout.trimEnd().split('\n').length;

console.log(`${root}`);
// Stated once so the timings below are admissible, and then not the subject:
// what is being compared is two programs reading the same files, not two ways
// of finding them. Discovery happens before either clock starts.
console.log(`${files.length} modules read here, ${seen} read by ripgrep`);
console.log(`${cpus()[0].model}, ${cpus().length} cores, node ${process.versions.node}`);
console.log(rg === undefined ? 'ripgrep not installed — this side only\n' : `${version(rg)}\n`);

console.log(`${'threads'.padEnd(8)}${'ripgrep: open, read, search'.padStart(36)}${'sense: open, read, parse, extract'.padStart(36)}`);
console.log(`${''.padEnd(8)}${'ms'.padStart(12)}${'user'.padStart(12)}${'system'.padStart(12)}${'ms'.padStart(12)}${'user'.padStart(12)}${'system'.padStart(12)}`);

for (const width of widths) {
  const theirs = rg === undefined ? undefined : best(repeat, () => searched(rg, width));
  const ours = best(repeat, () => scanned(width));
  console.log(String(width).padEnd(8) + row(theirs) + row(ours));
}

/** The fastest of several runs, which is the run least disturbed by the machine. */
function best(times, once) {
  let held;
  for (let at = 0; at < times; at += 1) {
    const run = once();
    if (held === undefined || run.ms < held.ms) held = run;
  }

  return held;
}

function row(run) {
  if (run === undefined) return `${'—'.padStart(12)}${'—'.padStart(12)}${'—'.padStart(12)}`;

  return (
    run.ms.toFixed(1).padStart(12) +
    `${run.user.toFixed(0)} ms`.padStart(12) +
    `${run.system.toFixed(0)} ms`.padStart(12)
  );
}

/** One `readBatch`, in its own process, reading and parsing at `width`. */
function scanned(threads) {
  const run = spawnSync(process.execPath, [process.argv[1], '--root', root], {
    encoding: 'utf8',
    env: { ...process.env, VA_SCAN_WIDTH: String(threads), RAYON_NUM_THREADS: String(threads) },
  });
  return JSON.parse(run.stdout);
}

/** One ripgrep pass at `-j threads`, timed by the kernel rather than by us. */
function searched(rg, threads) {
  const run = spawnSync(
    '/usr/bin/time',
    ['-p', rg, `-j${threads}`, '--no-messages', '-c', ABSENT, '-g', GLOB, '.'],
    { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 },
  );
  const of = (name) => Number(new RegExp(`${name}\\s+([0-9.]+)`, 'u').exec(run.stderr)?.[1] ?? 0) * 1000;

  return { ms: of('real'), user: of('user'), system: of('sys') };
}

async function modules(at) {
  const { stdout } = await promisify(execFile)('git', ['ls-files', '-z'], { cwd: at, maxBuffer: 1 << 28 });

  return stdout.split('\0').filter((file) => MODULES.test(file));
}

function which() {
  for (const at of ['/opt/homebrew/bin/rg', '/usr/local/bin/rg', '/usr/bin/rg']) {
    if (spawnSync(at, ['--version'], { encoding: 'utf8' }).status === 0) return at;
  }

  return undefined;
}

function version(rg) {
  return spawnSync(rg, ['--version'], { encoding: 'utf8' }).stdout.split('\n')[0];
}
