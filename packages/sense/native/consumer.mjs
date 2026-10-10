#!/usr/bin/env node

/**
 * Build the instrumenter crate the way a project that installed sense does.
 *
 * `native/instrument` reaches a Rust pipeline as a Cargo path dependency into
 * `node_modules`, with nothing of this repository around it: no workspace and
 * no sibling crate. `cargo test` here compiles it as a member
 * of the addon's workspace, which is a different build, so this lays the
 * crate's tracked files out where an install puts them, under a consumer crate
 * of its own, and runs that consumer once. `tools/native-packages.check.ts`
 * holds the other half: what is tracked here is what is packed.
 *
 * The addon's lockfile is copied in as the consumer's, so the crate resolves to
 * the versions this repository builds — the parser is pinned exactly in the
 * crate's manifest, so a project's own resolution differs only below it — and the run needs no registry it has not
 * already fetched; the consumer shares `target/` with the addon's release build
 * for the same reason.
 */

import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const consumer = mkdtempSync(join(tmpdir(), 'sense-consumer-'));

try {
  const crate = join(consumer, 'node_modules', '@variance-authority', 'sense', 'native', 'instrument');
  const tracked = spawnSync('git', ['ls-files', '-z', '--', 'instrument'], { cwd: here, encoding: 'utf8' });
  if (tracked.status !== 0) throw new Error(`git ls-files failed: ${tracked.stderr}`);
  for (const file of tracked.stdout.split('\0').filter(Boolean)) {
    const to = join(crate, file.slice('instrument/'.length));
    mkdirSync(dirname(to), { recursive: true });
    copyFileSync(join(here, file), to);
  }

  writeFileSync(
    join(consumer, 'Cargo.toml'),
    [
      '[package]',
      'name = "consumer"',
      'version = "0.0.0"',
      'edition = "2021"',
      'publish = false',
      '',
      '[dependencies]',
      'variance-sense-instrument = { path = "node_modules/@variance-authority/sense/native/instrument" }',
      '',
    ].join('\n'),
  );
  copyFileSync(join(here, 'Cargo.lock'), join(consumer, 'Cargo.lock'));
  mkdirSync(join(consumer, 'src'));
  writeFileSync(
    join(consumer, 'src', 'main.rs'),
    [
      'use variance_sense_instrument::{instrument, module_id, recipe, Mode};',
      '',
      'fn main() {',
      '    let source = "export function f(x) {\\n  if (x) return 1;\\n  return 0;\\n}\\n";',
      '    let id = module_id("src/f.ts", source);',
      '    let out = instrument(source, "src/f.ts", &id, Mode::Presence).expect("it parses");',
      '    println!("{}", recipe(Mode::Presence));',
      '    println!("{}", out.regions);',
      '    print!("{}", out.code);',
      '}',
      '',
    ].join('\n'),
  );

  const run = spawnSync(process.env['CARGO'] ?? 'cargo', ['run', '--release', '--quiet'], {
    cwd: consumer,
    encoding: 'utf8',
    env: { ...process.env, CARGO_TARGET_DIR: join(here, 'target') },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  if (run.status !== 0) throw new Error(`the consumer did not build or run (exit ${run.status})`);

  const [recipe, regions, ...code] = run.stdout.split('\n');
  // The module's text ends in a newline, so the last element is the empty rest after it.
  const lines = code.length - 1;
  const expected = [
    [recipe?.startsWith('sense:instrument/presence-v5+'), `a recipe under presence, not ${recipe}`],
    [regions === '5', `5 regions (the module, f, both arms and what follows), not ${regions}`],
    [lines === 4 && code.at(-1) === '', `the module's 4 lines and nothing after, not ${lines}`],
    [code[0]?.includes('.r("src/f.ts@'), 'the header reporting under the module id'],
  ].filter(([held]) => !held);
  if (expected.length > 0) {
    throw new Error(`the consumer ran, and wrote:\n${run.stdout}\nexpected ${expected.map(([, what]) => what).join('; ')}`);
  }
  console.log('sense: the instrumenter crate builds and runs as a path dependency in node_modules');
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
