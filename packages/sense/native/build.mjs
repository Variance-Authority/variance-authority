#!/usr/bin/env node

/**
 * Build the native scanner, and put it where the loader looks.
 *
 * `cargo` produces a `cdylib` under its own name and extension; Node loads a
 * `.node`, which is the same Mach-O or ELF object under a different suffix. The
 * copy is the whole build step — there is no bundler here, no generated
 * bindings and no platform packages, because the addon is internal to this
 * package and is loaded only when it is there.
 *
 * A missing toolchain is not a failure. The JavaScript scanner is the
 * implementation of record and the native one is an acceleration of it, so a
 * checkout without `cargo` builds, tests and scans — it scans slower, and
 * `native.test.ts` says which half ran.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

/** Where `cargo` writes, and what it calls the artifact on this platform. */
const ARTIFACT = {
  darwin: 'libsense_native.dylib',
  linux: 'libsense_native.so',
  win32: 'sense_native.dll',
}[process.platform];

const cargo = process.env['CARGO'] ?? join(process.env['HOME'] ?? '', '.cargo', 'bin', 'cargo');
const found = spawnSync(cargo, ['--version'], { stdio: 'ignore' });

if (found.status !== 0) {
  console.log('sense: no cargo on PATH, skipping the native scanner');
  process.exit(0);
}

if (ARTIFACT === undefined) {
  console.log(`sense: no native scanner for ${process.platform}, skipping`);
  process.exit(0);
}

const built = spawnSync(cargo, ['build', '--release'], { cwd: here, stdio: 'inherit' });
if (built.status !== 0) process.exit(built.status ?? 1);

const from = join(here, 'target', 'release', ARTIFACT);
const into = join(here, '..', 'dist', 'native');
mkdirSync(into, { recursive: true });
copyFileSync(from, join(into, 'scan.node'));

console.log(`sense: native scanner at ${join(into, 'scan.node')}`);
if (!existsSync(join(into, 'scan.node'))) process.exit(1);
