import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { caseIndexOf } from './case-record.js';
import { decodeExecutionIndex } from './execution-format.js';
import { decodeTestCoverage } from './format.js';
import { recordCargo, selectTestFiles } from './index.js';

const repository = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/cargo-crate');
const broken = resolve(repository, 'packages/sense/test/fixtures/cargo-broken');
const failing = resolve(repository, 'packages/sense/test/fixtures/cargo-failing');
// Recorded names are relative to the checkout, and the fixture sits inside it.
const lib = `${relative(repository, fixture)}/src/lib.rs`;
const negates = `${relative(repository, fixture)}/tests/negates.rs`;
const custom = `${relative(repository, fixture)}/tests/custom.rs`;
const exits = `${relative(repository, fixture)}/tests/exits.rs`;
const launches = `${relative(repository, fixture)}/tests/launches.rs`;
const aborts = `${relative(repository, fixture)}/tests/aborts.rs`;
// The binary's own unit tests: none, so the row holds no case.
const main = `${relative(repository, fixture)}/src/main.rs`;

/** A diff that changes one line of `src/lib.rs`. */
const editing = (source: string, line: string, edited: string): string => {
  const at = source.split('\n').indexOf(line) + 1;
  return `--- a/${lib}\n+++ b/${lib}\n@@ -${at},1 +${at},1 @@\n-${line}\n+${edited}`;
};

describe('a Cargo suite recorded one test per process', () => {
  const previous = { cache: process.env['VARIANCE_AUTHORITY_CACHE'], target: process.env['CARGO_TARGET_DIR'] };
  let directory: string;
  let coverageFile: string;
  let failed: number | undefined;

  beforeAll(async () => {
    directory = await mkdtemp(resolve(tmpdir(), 'variance-authority-cargo-'));
    process.env['VARIANCE_AUTHORITY_CACHE'] = directory;
    process.env['CARGO_TARGET_DIR'] = resolve(directory, 'target');
    coverageFile = resolve(directory, 'coverage.bin');
    failed = await recordCargo({ cwd: fixture, coverageFile });
  }, 240_000);

  afterAll(async () => {
    for (const [name, value] of [['VARIANCE_AUTHORITY_CACHE', previous.cache], ['CARGO_TARGET_DIR', previous.target]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(directory, { recursive: true, force: true });
  });

  it('writes each file tests are declared in as a row, every test passing', async () => {
    expect(failed).toBe(0);
    expect(decodeTestCoverage(await readFile(coverageFile)).tests.map((test) => test.file).sort()).toEqual([lib, main, aborts, custom, exits, launches, negates].sort());
  });

  // What ran there is not known, so an edit anywhere selects them.
  it('records a target that lists no test, one whose test left no profile, and one whose test started a process that left none, as incomplete', async () => {
    const rows = decodeTestCoverage(await readFile(coverageFile)).tests;
    expect(rows.filter((test) => !test.complete).map((test) => test.file).sort()).toEqual([aborts, custom, exits]);
  });

  it('leaves no profile behind in the crate, from building, listing or running the tests', async () => {
    const left = await readdir(fixture, { recursive: true });
    expect(left.filter((path) => path.endsWith('.profraw'))).toEqual([]);
  });

  it('names a case by its libtest path, and charges `add` to the cases that ran it, in their process or one they started', async () => {
    const cases = await caseIndexOf(coverageFile);
    if (cases === undefined) throw new Error('the run wrote no execution index');
    const index = decodeExecutionIndex(cases);
    expect(index.tests.map((test) => test.id).sort()).toEqual([`${lib} > tests::adds`, `${lib} > tests::muls`, `${lib} > tests::negs`, `${aborts} > aborts`, `${exits} > exits`, `${launches} > launches`, `${negates} > negates`].sort());
    const source = await readFile(resolve(fixture, 'src/lib.rs'), 'utf8');
    const line = source.split('\n').findIndex((text) => text.startsWith('pub fn add')) + 1;
    const module = index.modules.find((entry) => entry.file === lib);
    const add = module?.blocks.findLast((block) => block.startLine <= line && line <= block.endLine);
    expect(add?.crossings.map((crossing) => index.tests[crossing.test]!.id).sort()).toEqual([`${lib} > tests::adds`, `${lib} > tests::muls`, `${launches} > launches`].sort());
  });

  // A line inside a function's body: one that opens it, as a one-line `fn` does, is the root's text too.
  it('selects the files whose tests ran an edited function, and skips the rest', async () => {
    const source = await readFile(resolve(fixture, 'src/lib.rs'), 'utf8');
    await expect(selectTestFiles(coverageFile, editing(source, '    for _ in 0..b { r = add(r, a); }', '    for _ in 0..b { r = add(a, r); }')))
      .resolves.toEqual([lib]);
    await expect(selectTestFiles(coverageFile, editing(source, '    if a > 0 { -a } else { a.abs() * -1 * -1 * -1 }', '    if a > 0 { 0 - a } else { a }')))
      .resolves.toEqual([lib, negates]);
  });

  // What Cargo builds from is read by no test, yet changes what every test runs.
  it('selects every file when a manifest, a build script, a file it names or a file the source includes changes', async () => {
    const crate = relative(repository, fixture);
    for (const file of ['Cargo.toml', 'Cargo.lock', 'build.rs', 'schema.txt', 'src/greeting.txt']) {
      const diff = `--- a/${crate}/${file}\n+++ b/${crate}/${file}\n@@ -1,1 +1,1 @@\n-a\n+b`;
      await expect(selectTestFiles(coverageFile, diff)).resolves.toEqual([lib, main, aborts, custom, exits, launches, negates].sort());
    }
  });

  // `src/main.rs` runs only in the process `tests/launches.rs` starts.
  it('selects the file whose test launched the binary an edited function is in', async () => {
    const source = await readFile(resolve(fixture, 'src/main.rs'), 'utf8');
    const at = source.split('\n').indexOf('    calc::add(a, a)') + 1;
    const diff = `--- a/${main}\n+++ b/${main}\n@@ -${at},1 +${at},1 @@\n-    calc::add(a, a)\n+    calc::add(a, a) + 0`;
    await expect(selectTestFiles(coverageFile, diff)).resolves.toEqual([launches, main].sort());
  });

  it('records the workspace `--manifest-path` names, from outside it', async () => {
    const elsewhere = resolve(directory, 'elsewhere.bin');
    await expect(recordCargo({ cwd: directory, coverageFile: elsewhere, args: ['--manifest-path', resolve(fixture, 'Cargo.toml')] })).resolves.toBe(0);
    expect(decodeTestCoverage(await readFile(elsewhere)).tests.map((test) => test.file).sort()).toEqual([lib, main, aborts, custom, exits, launches, negates].sort());
  }, 240_000);

  it('answers a build that failed, naming what rustc said', async () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => written.push(String(chunk)) > 0);
    try {
      await expect(recordCargo({ cwd: broken, coverageFile: resolve(directory, 'broken.bin') })).resolves.toBeUndefined();
    } finally {
      spy.mockRestore();
    }
    expect(written.join('')).toContain('mismatched types');
  }, 240_000);

  // Its library has a failing test, and its `harness = false` target fails when run whole.
  it('answers how many tests failed, prints their output, and records their rows as incomplete', async () => {
    const written: string[] = [];
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => written.push(String(chunk)) > 0);
    const record = resolve(directory, 'failing.bin');
    const wrapper = process.env['RUSTC_WORKSPACE_WRAPPER'];
    process.env['RUSTC_WORKSPACE_WRAPPER'] = 'theirs';
    try {
      await expect(recordCargo({ cwd: directory, coverageFile: record, args: [`--manifest-path=${resolve(failing, 'Cargo.toml')}`] })).resolves.toBe(2);
    } finally {
      spy.mockRestore();
      if (wrapper === undefined) delete process.env['RUSTC_WORKSPACE_WRAPPER'];
      else process.env['RUSTC_WORKSPACE_WRAPPER'] = wrapper;
    }
    expect(written.join('')).toContain('replaces RUSTC_WORKSPACE_WRAPPER (theirs)');
    expect(written.join('')).toContain('half rounds down');
    expect(written.join('')).toContain('custom harness');
    const crate = relative(repository, failing);
    const rows = decodeTestCoverage(await readFile(record)).tests;
    expect(rows.filter((test) => !test.complete).map((test) => test.file).sort()).toEqual([`${crate}/src/lib.rs`, `${crate}/tests/custom.rs`]);
  }, 240_000);

  it('refuses a directory that holds no Cargo workspace, naming `cargo metadata`', async () => {
    const empty = await mkdtemp(resolve(tmpdir(), 'variance-authority-no-cargo-'));
    try {
      await expect(recordCargo({ cwd: empty, coverageFile: resolve(empty, 'none.bin') })).rejects.toThrow(/cargo metadata/);
    } finally {
      await rm(empty, { recursive: true, force: true });
    }
  });

  it('selects every file whose tests ran a file when the edit is outside every function', async () => {
    const source = await readFile(resolve(fixture, 'src/lib.rs'), 'utf8');
    await expect(selectTestFiles(coverageFile, editing(source, '    use super::*;', '    use super::{add, mul, neg};')))
      .resolves.toEqual([lib, launches, negates].sort());
  });
});
