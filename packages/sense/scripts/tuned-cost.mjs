#!/usr/bin/env node

/**
 * The same scanner, compiled for different Apple Silicon generations.
 *
 * The macOS package ships one binary, built for the floor of the platform, and
 * this is what re-asks whether a generation is worth a second. `-C target-cpu`
 * is the knob: rustc's default for `aarch64-apple-darwin` is already
 * `apple-m1`, so the comparison is always one generation against another and
 * never tuned against untuned. It has been asked once and the answer was no —
 * see journal 0066 — which is a result worth being able to reproduce.
 *
 * It measures code generation and nothing else. The width of each stage is the
 * larger lever on a newer machine, and this script cannot see it: every variant
 * here runs the same schedule.
 *
 * **Size is the variable that matters, and it is the one this repository cannot
 * supply.** At the scale of a checkout kept here the stage is bound by `open`
 * and every variant lands inside the noise; the separation appears on
 * repositories where the parse and the resolve are what the clock is spent on.
 * So point `--root` at the largest real checkout available, and read a result
 * from anything smaller as "this corpus cannot tell", not as "there is nothing
 * to find".
 *
 * Two things make the answer trustworthy:
 *
 *   interleaved — variants run round by round rather than in blocks, because a
 *                 laptop's clock falls as it heats and a block order hands that
 *                 fall to whichever variant ran last.
 *   two clocks  — wall time and user CPU time. [Journal
 *                 0059](../../../docs/context/journal/0059-ripgrep-stops-exactly-where-we-do.md)
 *                 measured this stage as kernel-bound on `open`, so a wall clock
 *                 alone would hide an instruction set that helped. User time is
 *                 the half a compiler can reach.
 *
 * Read the two builds that differ by nothing as the noise floor: pass the
 * default and `apple-m1`, which compile to the same feature set, and whatever
 * they disagree by is what this machine cannot resolve.
 *
 * ```sh
 * node scripts/tuned-cost.mjs --root ~/dev/material-ui --cpus default,apple-m1,apple-m4
 * ```
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { cpus, tmpdir } from 'node:os';
import { cpuUsage } from 'node:process';
import { createRequire } from 'node:module';
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODULES = /\.(m|c)?[jt]sx?$/u;
/** No cap, so every variant reads the same bytes. */
const EVERYTHING = 0xffffffff;
/** One reader: the parallel widths this stage runs at cannot resolve a per cent. */
const READERS = 1;

const here = dirname(fileURLToPath(import.meta.url));

const argued = new Map();
for (let at = 2; at < process.argv.length; at += 2) {
  argued.set(process.argv[at].replace(/^--/u, ''), process.argv[at + 1]);
}
const root = resolve(argued.get('root') ?? '.');
const rounds = Number(argued.get('rounds') ?? 9);
const wanted = (argued.get('cpus') ?? 'default,apple-m1,apple-m4').split(',');

const files = execFileSync('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 1 << 28 })
  .toString()
  .split('\0')
  .filter((file) => MODULES.test(file));

// A child per run: a process that has loaded one addon cannot load another, and
// a fresh one also starts with the same cold V8 as the run before it.
if (process.env.VA_TUNED_ADDON !== undefined) {
  const addon = createRequire(import.meta.url)(process.env.VA_TUNED_ADDON);
  // Warm the page cache and the allocator pool, so the measured pass measures
  // neither.
  addon.readBatch(root, files.slice(0, 64), EVERYTHING, true, READERS);
  const cpu = cpuUsage();
  const at = process.hrtime.bigint();
  addon.readBatch(root, files, EVERYTHING, true, READERS);
  const ms = Number(process.hrtime.bigint() - at) / 1e6;
  process.stdout.write(JSON.stringify({ ms, user: cpuUsage(cpu).user / 1000 }));
  process.exit(0);
}

const into = join(tmpdir(), 'sense-tuned');
mkdirSync(into, { recursive: true });
const built = new Map();
for (const cpu of wanted) {
  process.stderr.write(`building ${cpu}\n`);
  const run = spawnSync(cargo(), ['build', '--release'], {
    cwd: join(here, '..', 'native'),
    stdio: ['ignore', 'ignore', 'inherit'],
    env: {
      ...process.env,
      CARGO_TARGET_DIR: join(into, `target-${cpu}`),
      ...(cpu === 'default' ? {} : { RUSTFLAGS: `${process.env.RUSTFLAGS ?? ''} -C target-cpu=${cpu}`.trim() }),
    },
  });
  if (run.status !== 0) process.exit(run.status ?? 1);
  const addon = join(into, `${cpu}.node`);
  copyFileSync(join(into, `target-${cpu}`, 'release', artifact()), addon);
  built.set(cpu, { addon, wall: [], user: [] });
}

for (let round = 0; round < rounds; round += 1) {
  const order = [...built.keys()];
  for (const cpu of round % 2 === 0 ? order : order.reverse()) {
    const held = built.get(cpu);
    const run = spawnSync(process.execPath, [process.argv[1], '--root', root], {
      encoding: 'utf8',
      env: { ...process.env, VA_TUNED_ADDON: held.addon, RAYON_NUM_THREADS: String(READERS) },
    });
    const answer = JSON.parse(run.stdout);
    held.wall.push(answer.ms);
    held.user.push(answer.user);
  }
}

console.log(`${root}`);
console.log(`${files.length} modules, ${READERS} reader(s), ${rounds} rounds`);
console.log(`${cpus()[0].model}, ${cpus().length} cores, node ${process.versions.node}\n`);
console.log(`${'target-cpu'.padEnd(14)}${'wall: best'.padStart(12)}${'median'.padStart(10)}${'user: best'.padStart(12)}${'median'.padStart(10)}`);
for (const [cpu, held] of built) {
  console.log(cpu.padEnd(14) + column(held.wall) + column(held.user));
}

/** The fastest run and the middle one: the first is the least disturbed, the second says how disturbed. */
function column(runs) {
  const sorted = [...runs].sort((a, b) => a - b);
  return sorted[0].toFixed(1).padStart(12) + sorted[(sorted.length - 1) >> 1].toFixed(1).padStart(10);
}

function artifact() {
  return { darwin: 'libsense_native.dylib', linux: 'libsense_native.so', win32: 'sense_native.dll' }[
    process.platform
  ];
}

function cargo() {
  const found = [process.env.CARGO, 'cargo', join(process.env.HOME ?? '', '.cargo', 'bin', 'cargo')]
    .filter((candidate) => candidate !== undefined && candidate !== '')
    .find((candidate) => spawnSync(candidate, ['--version'], { stdio: 'ignore' }).status === 0);
  if (found === undefined) {
    console.error('sense: no cargo, so there is nothing to compare');
    process.exit(1);
  }

  return found;
}
