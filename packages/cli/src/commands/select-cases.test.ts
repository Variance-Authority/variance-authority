import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { digestString } from '@variance-authority/core/format';
import {
  encodeExecutionIndex,
  testCoverageFile,
  writeTestCoverage,
  type ExecutionBlock,
  type ExecutionIndex,
  type ExecutionNarrowing,
  type TestCoverage,
} from '@variance-authority/sense/test-selection';
import { casesToSkip } from './select-cases.js';
import { selectSuite } from './select-command.js';
import { indexOutput } from './index-command.js';

/**
 * Case grain: a change runs the cases of a selected file that ran the changed
 * code, and skips the rest of that file's cases, where the record can say which
 * those are. Wherever it cannot, the file runs whole, as at file grain.
 */
describe('the cases a selected file may skip', () => {
  const ALPHA = 'test/alpha.test.ts';
  const cases = [
    { id: 'alpha > calls widget', file: ALPHA, name: 'calls widget', stopped: false },
    { id: 'alpha > calls other', file: ALPHA, name: 'calls other', stopped: false },
  ];
  const block = (name: string, startLine: number, endLine: number, crossings: ExecutionBlock['crossings'], loaded?: true): ExecutionBlock => ({
    kind: 'function', name, path: name, startLine, endLine, source: true, crossings, ...(loaded ? { loaded } : {}),
  });
  const index = (widget: ExecutionBlock['crossings'], options: { tests?: ExecutionIndex['tests']; loaded?: true } = {}): ExecutionIndex => ({
    tests: options.tests ?? cases,
    modules: [{
      file: 'src/widget.ts',
      blocks: [block('widget', 1, 3, widget, options.loaded), block('other', 5, 7, [{ test: 1, distance: 0 }])],
    }],
  });
  const region = { kind: 'region' as const, file: 'src/widget.ts', name: 'widget', path: 'widget', startLine: 1, endLine: 3 };
  const narrowing = (via: ExecutionNarrowing['because'][number]['via'] = [region]): Pick<ExecutionNarrowing, 'whole' | 'because'> => ({
    whole: [ALPHA],
    because: [{ test: ALPHA, via }],
  });

  it('skips the cases that did not enter the changed region', () => {
    expect(casesToSkip(index([{ test: 0, distance: 0 }]), narrowing())).toEqual(new Map([[ALPHA, ['calls other']]]));
  });

  it('runs the file whole when a case of it entered the region while its module loaded', () => {
    expect(casesToSkip(index([{ test: 0, distance: 0 }, { test: 1, distance: 0, loaded: true }]), narrowing())).toEqual(new Map());
  });

  it('runs the file whole when the region ran while loading and the record cannot say who loaded it', () => {
    expect(casesToSkip(index([{ test: 0, distance: 0 }], { loaded: true }), narrowing())).toEqual(new Map());
  });

  it('runs the file whole when something other than a region selected it', () => {
    expect(casesToSkip(index([{ test: 0, distance: 0 }]), narrowing([region, { kind: 'precondition', name: ALPHA }]))).toEqual(new Map());
  });

  it('runs the file whole when the cases do not hold the region the selection named', () => {
    expect(casesToSkip(index([{ test: 0, distance: 0 }]), narrowing([{ ...region, startLine: 2 }]))).toEqual(new Map());
  });

  it('runs a case whose journey was cut short, or not seen to end', () => {
    const tests = [cases[0]!, { ...cases[1]!, stopped: true }];
    expect(casesToSkip(index([{ test: 0, distance: 0 }], { tests }), narrowing())).toEqual(new Map());
    const { stopped: _, ...unseen } = cases[1]!;
    expect(casesToSkip(index([{ test: 0, distance: 0 }], { tests: [cases[0]!, unseen] }), narrowing())).toEqual(new Map());
  });

  it('runs a case that shares its name with a case that entered', () => {
    const tests = [cases[0]!, { ...cases[1]!, name: 'calls widget' }];
    expect(casesToSkip(index([{ test: 0, distance: 0 }], { tests }), narrowing())).toEqual(new Map());
  });

  it('reads every row of a file, as a source and the build mapped onto it each give one', () => {
    const twice: ExecutionIndex = {
      tests: cases,
      modules: [
        { file: 'src/widget.ts', blocks: [block('widget', 1, 3, [{ test: 1, distance: 0 }])] },
        { file: 'src/widget.ts', blocks: [block('widget', 1, 3, [{ test: 0, distance: 0 }]), block('other', 5, 7, [{ test: 1, distance: 0 }])] },
      ],
    };
    expect(casesToSkip(twice, narrowing())).toEqual(new Map());
  });

  it('runs the file whole when one row of the region ran while its module loaded', () => {
    const twice: ExecutionIndex = {
      tests: cases,
      modules: [
        { file: 'src/widget.ts', blocks: [block('widget', 1, 3, [], true)] },
        { file: 'src/widget.ts', blocks: [block('widget', 1, 3, [{ test: 0, distance: 0 }])] },
      ],
    };
    expect(casesToSkip(twice, narrowing())).toEqual(new Map());
  });

  it('runs the file whole when no case of it entered', () => {
    expect(casesToSkip(index([]), narrowing())).toEqual(new Map());
  });

  it('cuts nothing in a file the record does not hold whole', () => {
    expect(casesToSkip(index([{ test: 0, distance: 0 }]), { whole: [], because: narrowing().because })).toEqual(new Map());
  });
});

describe('selecting at case grain', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    process.env['VARIANCE_AUTHORITY_CACHE'] = mkdtempSync(join(tmpdir(), 'va-cases-cache-'));
  });

  afterEach(() => {
    process.chdir(cwd);
    delete process.env['VARIANCE_AUTHORITY_CACHE'];
  });

  it('names the cases of a selected file that did not run the changed body', async () => {
    const root = await recorded();
    writeFileSync(join(root, 'src/widget.ts'), SOURCE.replace("return 'a';", "return 'A';"));

    const selected = await selectSuite({ root, grain: 'case' });

    expect([...selected.skip]).toEqual(['test/beta.test.ts']);
    expect(selected.cases).toEqual(new Map([['test/alpha.test.ts', ['calls other']]]));
  });

  it('names none at file grain', async () => {
    const root = await recorded();
    writeFileSync(join(root, 'src/widget.ts'), SOURCE.replace("return 'a';", "return 'A';"));

    const selected = await selectSuite({ root });

    expect([...selected.skip]).toEqual(['test/beta.test.ts']);
    expect(selected.cases).toBeUndefined();
  });

  it.todo(
    'cuts a file the last run ran in part again — needs the record to keep the skipped cases\' reach, so the file reads whole after a cut',
  );

  it.todo('cuts the cases of a file whose tests last ran at a stand — needs the cut read against each stand\'s own diff');

  it('runs the file whole when the change reached both of its cases', async () => {
    const root = await recorded();
    writeFileSync(join(root, 'src/widget.ts'), SOURCE.replace("return 'a';", "return 'A';").replace("return 'b';", "return 'B';"));

    const selected = await selectSuite({ root, grain: 'case' });

    expect(selected.cases).toEqual(new Map());
  });
});

const SOURCE = [
  'export function widget(): string {',
  "  return 'a';",
  '}',
  '',
  'export function other(): string {',
  "  return 'b';",
  '}',
  '',
].join('\n');

/**
 * A checkout at the text below, recorded: `alpha` has a case that entered
 * `widget` and one that entered `other`; `beta` entered `other` alone.
 */
async function recorded(): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'va-cases-'));
  const git = (args: readonly string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'src/widget.ts'), SOURCE);
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the text these line numbers are coordinates in']);
  const commit = git(['rev-parse', 'HEAD']);

  const record: TestCoverage = {
    version: 3,
    instrumentation: 'fixture',
    commit,
    tests: ['alpha', 'beta'].map((name) => ({ file: `test/${name}.test.ts`, complete: true, preconditions: [] })),
    modules: [{
      file: 'src/widget.ts',
      sourceDigest: digestString(SOURCE),
      instrumented: true,
      blocks: [
        { ordinal: 0, kind: 'module', digest: digestString('module'), name: 'widget.ts', path: 'module', startLine: 1, endLine: 8, source: true, testFiles: ['test/alpha.test.ts', 'test/beta.test.ts'] },
        { ordinal: 1, kind: 'function', owner: 0, digest: digestString('widget'), name: 'widget', path: 'widget', startLine: 1, endLine: 3, source: true, testFiles: ['test/alpha.test.ts'] },
        { ordinal: 2, kind: 'function', owner: 0, digest: digestString('other'), name: 'other', path: 'other', startLine: 5, endLine: 7, source: true, testFiles: ['test/alpha.test.ts', 'test/beta.test.ts'] },
      ],
    }],
  };
  const tests = [
    { id: 'alpha > calls widget', file: 'test/alpha.test.ts', name: 'calls widget', stopped: false },
    { id: 'alpha > calls other', file: 'test/alpha.test.ts', name: 'calls other', stopped: false },
    { id: 'beta > calls other', file: 'test/beta.test.ts', name: 'calls other', stopped: false },
  ];
  const loaded = tests.map((_, test) => ({ test, distance: 0, loaded: true }));
  const cases: ExecutionIndex = {
    tests,
    modules: [{
      file: 'src/widget.ts',
      blocks: [
        { kind: 'module', name: 'widget.ts', path: 'module', startLine: 1, endLine: 8, source: true, crossings: loaded },
        { kind: 'function', name: 'widget', path: 'widget', startLine: 1, endLine: 3, source: true, crossings: [{ test: 0, distance: 1 }] },
        { kind: 'function', name: 'other', path: 'other', startLine: 5, endLine: 7, source: true, crossings: [{ test: 1, distance: 1 }, { test: 2, distance: 1 }] },
      ],
    }],
  };
  await writeTestCoverage(testCoverageFile(root), record, { index: encodeExecutionIndex(cases) });
  process.chdir(root);
  await indexOutput({ cwd: root });
  return root;
}
