import type { ExecutionIndex, TestCoverage } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { formatFileDistillation } from './index.js';
import { distillOf } from './record.fixture.js';

const FILE = 'test/dialog.test.tsx';

type Block = TestCoverage['modules'][number]['blocks'][number];

/** A module whose top level `loadedBy` evaluated, with one function per name. */
function loaded(file: string, lines: number, functions: readonly string[], by: readonly string[] = [FILE]) {
  const root: Block = {
    ordinal: 0, kind: 'module', digest: `${file}#root`, name: '', path: '', source: true,
    testFiles: by, loadedBy: by, startLine: 1, endLine: lines,
  };
  const declared = functions.map((name, at): Block => ({
    ordinal: at + 1, kind: 'function', owner: 0, digest: `${file}#${name}`, name, path: name,
    source: true, testFiles: by, startLine: at + 2, endLine: at + 2,
  }));
  return { file, sourceDigest: file, instrumented: true, blocks: [root, ...declared] };
}

const COVERAGE: TestCoverage = {
  version: 3,
  instrumentation: 'fixture-instrumentation',
  tests: [
    { file: FILE, complete: true, preconditions: [] },
    { file: 'test/other.test.ts', complete: true, preconditions: [] },
  ],
  modules: [
    loaded('src/button.tsx', 10, ['Button']),
    loaded('src/confirm-dialog.tsx', 40, ['ConfirmDialog']),
    // A barrel declares nothing below its top level: loading it ran all it has.
    loaded('src/index.ts', 3, []),
    loaded('src/heavy-editor.ts', 900, ['Editor']),
    loaded('src/fancy-error.tsx', 60, ['FancyError']),
    // Loaded by another file only.
    loaded('src/unrelated.ts', 80, ['work'], ['test/other.test.ts']),
    // An uninstrumented module keeps no regions: the record cannot say who loaded it.
    { file: 'src/opaque.js', sourceDigest: 'src/opaque.js', instrumented: false, blocks: [] },
    loaded(FILE, 30, ['helper']),
  ],
};

const block = (name: string, crossings: ExecutionIndex['modules'][number]['blocks'][number]['crossings']) => ({
  kind: 'function', name, path: name, startLine: 2, endLine: 2, source: true, crossings,
});

const EXECUTION: ExecutionIndex = {
  tests: [
    { id: `${FILE} > opens`, file: FILE, name: 'opens', stopped: false },
    { id: `${FILE} > cancels`, file: FILE, name: 'cancels', stopped: false },
    { id: `${FILE} > renders`, file: FILE, name: 'renders', stopped: false },
    { id: 'test/other.test.ts > works', file: 'test/other.test.ts', name: 'works', stopped: false },
  ],
  modules: [
    { file: 'src/button.tsx', blocks: [block('Button', [0, 1, 2].map((test) => ({ test, distance: 0 })))] },
    { file: 'src/confirm-dialog.tsx', blocks: [block('ConfirmDialog', [{ test: 0, distance: 0 }])] },
    // A producer that writes load per crossing: this one ran while the module evaluated.
    { file: 'src/fancy-error.tsx', blocks: [block('FancyError', [{ test: 2, distance: 0, loaded: true }])] },
    { file: 'src/unrelated.ts', blocks: [block('work', [{ test: 3, distance: 0 }])] },
  ],
};

describe('distillFile', () => {
  it('names the modules a test file loaded and only some of its cases, or none, entered', () => {
    const result = distillOf({ file: FILE, execution: EXECUTION, coverage: COVERAGE });

    expect(result.file).toBe(FILE);
    expect(result.cases.map((test) => test.name)).toEqual(['opens', 'cancels', 'renders']);
    // The test file itself, the barrel and the uninstrumented module are not counted.
    expect(result.loaded).toBe(4);
    expect(result.modules).toEqual([
      { file: 'src/heavy-editor.ts', lines: 900, entered: 0 },
      { file: 'src/fancy-error.tsx', lines: 60, entered: 0 },
      { file: 'src/confirm-dialog.tsx', lines: 40, entered: 1 },
    ]);
  });

  it('prints never before sometimes, with the share of cases that entered', () => {
    const text = formatFileDistillation(distillOf({ file: FILE, execution: EXECUTION, coverage: COVERAGE }));

    expect(text).toContain('test/dialog.test.tsx: 3 case(s); 4 loaded module(s) declare functions.');
    expect(text).toContain('Loaded, and entered by no case: 2 module(s), 960 line(s).');
    expect(text).toContain('  src/heavy-editor.ts — 900 line(s)');
    expect(text).toContain('Loaded, and entered by some cases only: 1 module(s), 40 line(s).');
    expect(text).toContain('  src/confirm-dialog.tsx — 40 line(s), entered by 1 of 3 case(s)');
    expect(text.indexOf('heavy-editor')).toBeLessThan(text.indexOf('confirm-dialog'));
  });

  it('reads a file whose record kept no cases as unmeasured, not as nothing entered', () => {
    const result = distillOf({ file: FILE, execution: { tests: [], modules: [] }, coverage: COVERAGE });

    expect(result.modules).toBeUndefined();
    expect(result.withheld).toBe('the record keeps no cases for test/dialog.test.tsx.');
    expect(formatFileDistillation(result)).toContain('unmeasured; the record keeps no cases for test/dialog.test.tsx.');
  });

  it('reads only the test file a path names, never one whose path contains it or ends in it', () => {
    for (const asked of ['test/dialog.test.ts', 'dialog.test.tsx', 'dialog', 'test/']) {
      expect(() => distillOf({ file: asked, execution: EXECUTION, coverage: COVERAGE }))
        .toThrow(`The record holds no test file \`${asked}\`.`);
    }
  });

  it('withholds the reading when a case stopped, or did not say whether it finished', () => {
    const tests = EXECUTION.tests.map(({ stopped, ...test }, at) =>
      at === 1 ? { ...test, stopped: true } : at === 2 ? test : { ...test, stopped });

    const result = distillOf({ file: FILE, execution: { ...EXECUTION, tests }, coverage: COVERAGE });

    expect(result.modules).toBeUndefined();
    expect(result.withheld).toBe(
      '2 of 3 case(s) stopped or did not say whether they finished, so what they would have entered is unknown.');
  });

  it('withholds the reading when the file\'s coverage row is incomplete', () => {
    const coverage: TestCoverage = {
      ...COVERAGE,
      tests: COVERAGE.tests.map((test) => (test.file === FILE ? { ...test, complete: false } : test)),
    };

    const result = distillOf({ file: FILE, execution: EXECUTION, coverage });

    expect(result.modules).toBeUndefined();
    expect(result.withheld).toContain(`the coverage row for ${FILE} is incomplete`);
    expect(result.withheld).toMatch(/so it cannot say what the file did without\.$/);
  });

  it('counts a module another file\'s case entered as entered by none of this file\'s cases', () => {
    const shared = loaded('src/shared.ts', 50, ['share'], [FILE, 'test/other.test.ts']);
    const coverage: TestCoverage = { ...COVERAGE, modules: [...COVERAGE.modules, shared] };
    const execution: ExecutionIndex = {
      ...EXECUTION,
      modules: [...EXECUTION.modules, { file: 'src/shared.ts', blocks: [block('share', [{ test: 3, distance: 0 }])] }],
    };

    expect(distillOf({ file: FILE, execution, coverage }).modules)
      .toContainEqual({ file: 'src/shared.ts', lines: 50, entered: 0 });
  });

  it('leaves out a module the file first loaded inside a case: it is already deferred', () => {
    const lazy = loaded('src/lazy.ts', 70, ['later']);
    const root = { ...lazy.blocks[0]!, loadedBy: [] };
    const coverage: TestCoverage = { ...COVERAGE, modules: [...COVERAGE.modules, { ...lazy, blocks: [root, ...lazy.blocks.slice(1)] }] };

    expect(distillOf({ file: FILE, execution: EXECUTION, coverage }).modules?.map(({ file }) => file))
      .not.toContain('src/lazy.ts');
  });

  it('does not count a crossing of the module root as an entry', () => {
    const rootCrossed: ExecutionIndex = {
      ...EXECUTION,
      modules: [
        ...EXECUTION.modules,
        {
          file: 'src/heavy-editor.ts',
          blocks: [{ ...block('', [0, 1, 2].map((test) => ({ test, distance: 0 }))), kind: 'module', path: '' }],
        },
      ],
    };

    const result = distillOf({ file: FILE, execution: rootCrossed, coverage: COVERAGE });

    expect(result.modules).toContainEqual({ file: 'src/heavy-editor.ts', lines: 900, entered: 0 });
  });

  it('takes a path that names one recorded test file exactly, though another contains it', () => {
    const coverage: TestCoverage = {
      ...COVERAGE,
      tests: [...COVERAGE.tests, { file: `${FILE}.snap.test.ts`, complete: true, preconditions: [] }],
    };

    expect(distillOf({ file: FILE, execution: EXECUTION, coverage }).file).toBe(FILE);
  });

  it('refuses a path no recorded test file has, and names no other path', () => {
    expect(() => distillOf({ file: 'missing', execution: EXECUTION, coverage: COVERAGE })).toThrow(
      'The record holds no test file `missing`. It names each test file by its path from the repository root, with `/`.',
    );
  });
});
