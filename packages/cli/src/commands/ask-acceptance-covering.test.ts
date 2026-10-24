import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { encodeAsSetExecutionIndex, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { covering } from './ask-facts.fixture.js';

/**
 * `variance covering --file` held to spec 0104: which tests entered a file.
 * Facts only, through `ask-facts`, over a record of two cases that each
 * entered one function of `src/cart.ts`; a todo is a fact the spec asks for
 * and the answer does not hold yet.
 */

const TOTALS = 'cart.test.ts > totals';
const ROUNDS = 'cart.test.ts > rounds';

let root = '';
let execution = '';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-acceptance-covering-'));
  execution = join(root, 'coverage.bin');
  const tests = [TOTALS, ROUNDS].map((id) => ({ id, file: 'cart.test.ts', name: id.split(' > ')[1]! }));
  await writeTestCoverage(execution, { version: 3, instrumentation: 'fixture-instrumentation', tests: [], modules: [] }, {
    index: encodeAsSetExecutionIndex({
      tests,
      modules: [{
        file: 'src/cart.ts',
        blocks: [
          { kind: 'function', name: 'total', path: 'entry', startLine: 1, endLine: 3, source: true, crossings: [{ test: 0, distance: 0 }] },
          { kind: 'function', name: 'round', path: 'entry', startLine: 5, endLine: 7, source: true, crossings: [{ test: 1, distance: 0 }] },
        ],
      }],
    }),
  });
});

describe('variance covering --file', () => {
  it('answers each region of the file with the cases that entered it', async () => {
    expect((await covering('src/cart.ts', execution, root)).regions).toEqual([
      { start: 1, end: 3, cases: [TOTALS] },
      { start: 5, end: 7, cases: [ROUNDS] },
    ]);
  });

  it('narrows to the cases that entered the line asked', async () => {
    expect((await covering('src/cart.ts', execution, root, ['--line', '6'])).cases).toEqual([ROUNDS]);
  });

  it('tells a record cut under other probes than this build places', async () => {
    expect(await covering('src/cart.ts', execution, root)).toMatchObject({ olderProbes: true, regions: [expect.anything(), expect.anything()] });
  });

  it('tells a file the run never loaded apart from one no case entered', async () => {
    expect(await covering('src/none.ts', execution, root)).toMatchObject({ unloaded: true, regions: [], cases: [] });
  });

  // Declared preconditions and a suite with no record keep their pins in
  // `covering-preconditions` and `covering-unrecorded`, which build the
  // configured checkout those answers need.

  it.todo('reads a path under dist/ as the source file it was built from — needs the resolver\'s outDir-to-rootDir mapping applied to the asked path');
  it.todo('answers a test file by the cases it holds, and a missing path once, as missing — needs a test file answered from its own cases, and a missing path checked before any suite');
  it.todo('prints repository-relative paths only, never the cache directory — needs every printed path made relative to the checkout');
  it.todo('names the commit its record was made at, and whether the file changed since — needs the record\'s commit read from its ledger and compared with the file\'s last change');
  it.todo('says the probe-version notice once per answer, not once per suite — needs the notice gathered across suites and printed after them');
  it.todo('answers in JSON one row per region and case, with no repeated case — needs the JSON keyed by region with each case listed once');
  it.todo('exits 1 when no record holds the file — needs the exit code chosen from the answer');
});
