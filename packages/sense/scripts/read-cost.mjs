#!/usr/bin/env node

/**
 * What reading a repository's source costs, one thread against every core.
 *
 * The stage is read + parse + extract, once per file — the part of a cold scan
 * that a CPU profile shows is 43% idle on a sixteen-core machine, because the
 * one JavaScript thread that does it is always waiting for the next file. It is
 * also the part with no shared state: a file's specifiers are a function of its
 * bytes and nothing else, so the only thing standing between it and every core
 * is the language it is written in.
 *
 * Both sides read the same files, in the same order, and are compared on their
 * answers before they are compared on their time — a faster wrong answer is not
 * a result. The largest-file cap is lifted on the native side for the same
 * reason: the comparison is only a comparison if both sides parsed the same
 * bytes, and declining a megabyte of generated client is a saving that belongs
 * to the scan rather than to either implementation. `user/real` is the measurement that matters most here: it is how
 * many cores the stage actually took.
 *
 * ```sh
 * node scripts/read-cost.mjs --root ../../..
 * node scripts/read-cost.mjs --root ~/dev/material-ui --repeat 3
 * ```
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { cpuUsage } from 'node:process';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { MODULE_EXTENSIONS, readModule } from '../dist/read.js';
import { native } from '../dist/native.js';

const run = promisify(execFile);

/** Every file, however large — see the header. */
const NO_CAP = 0xffffffff;

const argued = new Map();
for (let at = 2; at < process.argv.length; at += 2) {
  argued.set(process.argv[at].replace(/^--/u, ''), process.argv[at + 1]);
}

const root = resolve(argued.get('root') ?? '.');
const repeat = Number(argued.get('repeat') ?? 1);
const addon = native();
if (addon === undefined) {
  console.error('no native scanner built — run `node native/build.mjs` first');
  process.exit(1);
}

const { stdout } = await run('git', ['ls-files', '-z'], { cwd: root, maxBuffer: 1 << 28 });
const files = stdout
  .split('\0')
  .filter((path) => path !== '' && MODULE_EXTENSIONS.some((end) => path.endsWith(end)));

let bytes = 0;
for (const file of files) {
  bytes += (await readFile(join(root, file)).catch(() => '')).length;
}

console.log(`${root}\n${files.length} modules, ${(bytes / 1024 / 1024).toFixed(1)} MiB\n`);

const kinds = addon.kinds();
let held;
for (let pass = 0; pass < repeat; pass += 1) {
  const script = await timed(() => js(files));
  const rust = await timed(() => addon.readBatch(root, files, NO_CAP));
  const answered = flatten(rust.value, kinds);

  if (held === undefined) held = { script: script.value, rust: answered };
  if (String(script.value) !== String(answered)) {
    console.error(`the two answers differ: ${differ(script.value, answered)}`);
    process.exit(1);
  }

  report(script, rust, script.value.length);
}

/** Read, parse and extract every file the way the scan does today: one at a time. */
async function js(files) {
  const held = [];
  for (const file of files) {
    let contents;
    try {
      contents = await readFile(join(root, file), 'utf8');
    } catch {
      held.push('');
      continue;
    }
    for (const request of readModule(file, contents).requests) {
      held.push(`${request.kind} ${request.value}`);
    }
  }

  return held;
}

/** The native columns as the same flat list, so the two can be compared at all. */
function flatten(batch, kinds) {
  const held = [];
  let at = 0;
  for (let file = 0; file < batch.counts.length; file += 1) {
    if (batch.counts[file] === 0 && batch.unknown[file].includes('could not be read')) held.push('');
    for (let step = 0; step < batch.counts[file]; step += 1, at += 1) {
      held.push(`${kinds[batch.kinds[at]]} ${batch.values[at]}`);
    }
  }

  return held;
}

function differ(left, right) {
  if (left.length !== right.length) return `${left.length} requests against ${right.length}`;
  const at = left.findIndex((held, index) => held !== right[index]);

  return `at ${at}: ${JSON.stringify(left[at])} against ${JSON.stringify(right[at])}`;
}

async function timed(work) {
  const cpu = cpuUsage();
  const at = process.hrtime.bigint();
  const value = await work();
  const ms = Number(process.hrtime.bigint() - at) / 1e6;
  const spent = cpuUsage(cpu);

  // User and system apart, because they name different defects: user time that
  // grows with threads is contention over a lock this program holds, and system
  // time that grows with threads is contention over one the kernel holds.
  return { value, ms, cores: (spent.user + spent.system) / 1000 / ms,
           user: spent.user / 1000 / ms, system: spent.system / 1000 / ms };
}

function report(script, rust, requests) {
  console.log(`${requests} requests`);
  console.log(
    `javascript  ${script.ms.toFixed(1).padStart(9)} ms  ${script.cores.toFixed(2)} cores`,
  );
  console.log(
    `native      ${rust.ms.toFixed(1).padStart(9)} ms  ${rust.cores.toFixed(2)} cores (${rust.user.toFixed(2)} user, ${rust.system.toFixed(2)} system)  ` +
      `${(script.ms / rust.ms).toFixed(1)}x\n`,
  );
}
