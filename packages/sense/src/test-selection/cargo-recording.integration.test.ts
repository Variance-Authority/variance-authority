import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { caseIndexOf } from './case-record.js';
import { decodeExecutionIndex } from './execution-format.js';
import { decodeTestCoverage } from './format.js';
import { recordCargo, selectTestFiles } from './index.js';

const repository = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/cargo-crate');
// Recorded names are relative to the checkout, and the fixture sits inside it.
const lib = `${relative(repository, fixture)}/src/lib.rs`;
const negates = `${relative(repository, fixture)}/tests/negates.rs`;

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
    expect(decodeTestCoverage(await readFile(coverageFile)).tests.map((test) => test.file).sort()).toEqual([lib, negates]);
  });

  it('leaves no profile behind in the crate, from building, listing or running the tests', async () => {
    const left = await readdir(fixture, { recursive: true });
    expect(left.filter((path) => path.endsWith('.profraw'))).toEqual([]);
  });

  it('names a case by its libtest path, and charges `add` to the cases that ran it alone', async () => {
    const cases = await caseIndexOf(coverageFile);
    if (cases === undefined) throw new Error('the run wrote no execution index');
    const index = decodeExecutionIndex(cases);
    expect(index.tests.map((test) => test.id).sort()).toEqual([`${lib} > tests::adds`, `${lib} > tests::muls`, `${lib} > tests::negs`, `${negates} > negates`]);
    const source = await readFile(resolve(fixture, 'src/lib.rs'), 'utf8');
    const line = source.split('\n').findIndex((text) => text.startsWith('pub fn add')) + 1;
    const module = index.modules.find((entry) => entry.file === lib);
    const add = module?.blocks.findLast((block) => block.startLine <= line && line <= block.endLine);
    expect(add?.crossings.map((crossing) => index.tests[crossing.test]!.id).sort()).toEqual([`${lib} > tests::adds`, `${lib} > tests::muls`]);
  });

  // A line inside a function's body: one that opens it, as a one-line `fn` does, is the root's text too.
  it('selects the files whose tests ran an edited function, and skips the rest', async () => {
    const source = await readFile(resolve(fixture, 'src/lib.rs'), 'utf8');
    await expect(selectTestFiles(coverageFile, editing(source, '    for _ in 0..b { r = add(r, a); }', '    for _ in 0..b { r = add(a, r); }')))
      .resolves.toEqual([lib]);
    await expect(selectTestFiles(coverageFile, editing(source, '    if a > 0 { -a } else { a.abs() * -1 * -1 * -1 }', '    if a > 0 { 0 - a } else { a }')))
      .resolves.toEqual([lib, negates]);
  });

  it('selects every file whose tests ran a file when the edit is outside every function', async () => {
    const source = await readFile(resolve(fixture, 'src/lib.rs'), 'utf8');
    await expect(selectTestFiles(coverageFile, editing(source, '    use super::*;', '    use super::{add, mul, neg};')))
      .resolves.toEqual([lib, negates]);
  });
});
