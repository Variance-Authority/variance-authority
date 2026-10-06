import type { ExecutionIndex, TestCoverage } from '@variance-authority/sense/test-selection';
import type { ShadowReach } from '@variance-authority/sense/taint';
import { describe, expect, it } from 'vitest';
import { distillFile, formatFileDistillation } from './index.js';

const FILE = 'test/card.test.ts';

const COVERAGE: TestCoverage = {
  version: 3,
  instrumentation: 'fixture-instrumentation',
  tests: [{ file: FILE, complete: true, preconditions: [] }],
  modules: [],
};

const EXECUTION: ExecutionIndex = {
  tests: [{ id: `${FILE} > renders`, file: FILE, name: 'renders', stopped: false }],
  modules: [],
};

/** The card's own import at one hop, the subject's import at two, an internal at three, a leftover at none. */
const REACH: readonly ShadowReach[] = [
  { module: 'src/api.ts', hops: 2, importer: 'src/card.ts' },
  { module: 'src/card.ts', hops: 1, importer: FILE },
  { module: 'src/client.ts', hops: 3, importer: 'src/api.ts' },
  { module: 'src/legacy.ts' },
];

const shadows = (file: string): readonly ShadowReach[] => (file === FILE ? REACH : []);

describe('the mocks a test file writes, held against what it loads', () => {
  it('names a mock of a module the file does not load as an error, and one beyond its subject\'s imports as a warning', () => {
    const result = distillFile({ file: 'card', execution: EXECUTION, coverage: COVERAGE, shadows });

    expect(result.mocks).toEqual([
      { module: 'src/legacy.ts', kind: 'unloaded' },
      { module: 'src/client.ts', kind: 'beyond', hops: 3, importer: 'src/api.ts' },
    ]);
  });

  it('prints the error and the warning before the loads, each with its fix', () => {
    const text = formatFileDistillation(distillFile({ file: 'card', execution: EXECUTION, coverage: COVERAGE, shadows }));

    expect(text).toContain(
      `error: ${FILE} mocks src/legacy.ts, which it does not load, directly or through anything it imports: ` +
        'the mock replaces nothing. Delete it.');
    expect(text).toContain(
      `warning: ${FILE} mocks src/client.ts, 3 imports away; src/api.ts imports it, and ${FILE} does not import ` +
        'src/api.ts. Mock the import of the subject that loads it, or fix src/api.ts.');
    expect(text.indexOf('Error:')).toBeLessThan(text.indexOf('Loaded, and entered'));
  });

  it('says nothing of mocks within the subject\'s imports, nor when the shadows are not given', () => {
    const near = (file: string) => shadows(file).filter(({ hops }) => hops !== undefined && hops <= 2);

    expect(distillFile({ file: 'card', execution: EXECUTION, coverage: COVERAGE, shadows: near }).mocks).toBeUndefined();
    expect(distillFile({ file: 'card', execution: EXECUTION, coverage: COVERAGE }).mocks).toBeUndefined();
  });

  it('holds the mocks against the graph when the record withholds the loads', () => {
    const result = distillFile({ file: 'card', execution: { tests: [], modules: [] }, coverage: COVERAGE, shadows });

    expect(result.withheld).toBe(`the record keeps no cases for ${FILE}.`);
    expect(result.mocks).toHaveLength(2);
    expect(formatFileDistillation(result)).toContain(`error: ${FILE} mocks src/legacy.ts`);
  });
});
