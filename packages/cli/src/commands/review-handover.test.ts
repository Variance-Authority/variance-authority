import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { caseSectionsAt, commitRunsFile, encodeExecutionIndex, testCoverageFile, withCaseSections } from '@variance-authority/sense/test-selection';
import { main } from '../bin.js';
import { readFlags } from '../args.js';
import { parseReviewArgs } from '../review-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { AFTER, DISCOUNTS, block, changed, git } from './review-fixture.js';
import { formatHandover, HANDOVER_END, HANDOVER_LINES, HANDOVER_START } from './review-handover.js';
import type { Review, ReviewRegion } from './review.js';
import { REVIEW_MARKER } from './review-text.js';

function parse(argv: readonly string[]) {
  return parseReviewArgs(readFlags(argv, 'review', flagsFor('review'), synopsisFor('review')));
}

async function printed(argv: readonly string[]): Promise<{ code: number; out: string; err: string }> {
  let out = '';
  let err = '';
  const code = await main(['review', ...argv], { out: (text) => (out += text), err: (text) => (err += text) });
  return { code, out, err };
}

describe('a review handed over in the pull request body, before CI', () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  it('leaves breadcrumbs: each changed function, whether a case reached it and from how far, and the test file to open', async () => {
    const { root, first } = await changed();
    await writeFile(join(root, 'src/total.ts'), `${AFTER}// not run yet\n`);

    const { code, out } = await printed(['--since', first, '--root', root, '--format', 'handover']);

    expect(code).toBe(0);
    expect(out).toBe([
      HANDOVER_START,
      '<details><summary>🧭 Coverage of the changed area: 2 changed functions, 1 new and not run yet</summary>',
      '',
      'Read from the record before this change ran.',
      '',
      '- 🔵 `round` in `src/total.ts` — new, not run yet',
      '',
      'And 1 more, every one reached by a case: 1 near.',
      '',
      `More on one file: \`variance covering --since ${first.slice(0, 12)} --file <path>\``,
      '</details>',
      HANDOVER_END,
      '',
    ].join('\n'));
    expect(out).not.toContain(REVIEW_MARKER);
  });

  it('stays a handful of lines however many functions the change touched, absences first', () => {
    const region = (name: string, reach: ReviewRegion['reach'], tests: readonly string[]): ReviewRegion => ({
      kind: 'function', name, startLine: 1, endLine: 2, reach, edit: 'modified', changedLineCases: tests.length, cases: tests.length, tests, called: [],
    });
    const files = Array.from({ length: 40 }, (_, at) => ({
      file: `src/f${String(at).padStart(2, '0')}.ts`,
      recorded: true,
      regions: [region(`f${at}`, at % 10 === 0 ? 'hole' : at % 3 === 0 ? 'far' : 'near', at % 10 === 0 ? [] : ['test/a.test.ts', 'test/b.test.ts'])],
    }));
    const review = { from: 'a'.repeat(40), record: 'before', base: 'since', files } as unknown as Review;

    const out = formatHandover([{ review }]);
    const crumbs = out.split('\n').filter((line) => line.startsWith('- '));

    expect(crumbs).toHaveLength(HANDOVER_LINES);
    expect(crumbs.slice(0, 4).every((line) => line.startsWith('- 🔴'))).toBe(true);
    expect(crumbs[4]).toBe('- 🟡 `f3` in `src/f03.ts` — 2 cases, far: `test/a.test.ts` and 1 more');
    expect(out).toContain('<summary>🧭 Coverage of the changed area: 40 changed functions, 4 with code the record holds no case for</summary>');
    expect(out).toContain('And 28 more, every one reached by a case: 4 far, 24 near.');
  });

  it('marks a distance as the review comment marks it', () => {
    const region = (name: string, reach: ReviewRegion['reach']): ReviewRegion => ({
      kind: 'function', name, startLine: 1, endLine: 2, reach, edit: 'modified', changedLineCases: 1, cases: 1, tests: ['test/a.test.ts'], called: [],
    });
    const files = (['unplaced', 'loaded'] as const).map((reach) => ({ file: `src/${reach}.ts`, recorded: true, regions: [region(reach, reach)] }));
    const review = { from: 'a'.repeat(40), record: 'before', base: 'since', files } as unknown as Review;

    expect(formatHandover([{ review }]).split('\n').filter((line) => line.startsWith('- '))).toEqual([
      '- ⚪ `loaded` in `src/loaded.ts` — 1 case, ran only while its module loaded: `test/a.test.ts`',
      '- 🟠 `unplaced` in `src/unplaced.ts` — 1 case, distance not measured: `test/a.test.ts`',
    ]);
  });

  it('names each changed function once, by the suite that reached it nearest, and passes over a top level any import runs', () => {
    const region = (name: string, reach: ReviewRegion['reach'], tests: readonly string[], kind = 'function'): ReviewRegion => ({
      kind, name, startLine: name === '' ? 1 : 5, endLine: 9, reach, edit: 'modified', changedLineCases: tests.length, cases: tests.length, tests, called: [],
    });
    const at = (regions: readonly ReviewRegion[]) =>
      ({ from: 'a'.repeat(40), record: 'before', base: 'since', files: [{ file: 'src/a.ts', recorded: true, regions }] }) as unknown as Review;

    const out = formatHandover([
      { suite: 'browser', review: at([region('', 'loaded', [], 'module'), region('total', 'hole', [])]) },
      { suite: 'unit', review: at([region('', 'near', ['test/a.test.ts'], 'module'), region('total', 'far', ['test/a.test.ts'])]) },
    ]);

    expect(out.split('\n').filter((line) => line.startsWith('- '))).toEqual([
      '- 🟡 `total` in `src/a.ts` — 1 case, far: `test/a.test.ts` (`unit`)',
    ]);
    expect(out).toContain('1 changed function, reached by a case');
  });

  it('names a function once however many of its branches changed, with the part no case ran first', () => {
    const part = (startLine: number, endLine: number, reach: ReviewRegion['reach'], tests: readonly string[]): ReviewRegion => ({
      kind: 'function', name: 'total', startLine, endLine, reach, edit: 'modified', changedLineCases: tests.length, cases: tests.length, tests, called: [],
    });
    const review = {
      from: 'a'.repeat(40), record: 'before', base: 'since',
      files: [{ file: 'src/a.ts', recorded: true, regions: [
        { ...part(1, 30, 'near', ['test/a.test.ts']), kind: 'module', name: '' },
        part(5, 20, 'near', ['test/a.test.ts']), part(8, 9, 'hole', []), part(12, 13, 'far', ['test/b.test.ts']),
      ] }],
    } as unknown as Review;

    const out = formatHandover([{ suite: 'unit', review }]);

    expect(out.split('\n').filter((line) => line.startsWith('- '))).toEqual([
      '- 🔴 `total` in `src/a.ts` — a part the record holds no case for; the rest 1 case, near: `test/a.test.ts`',
    ]);
    expect(out).toContain('1 changed function, 1 with code the record holds no case for');
  });

  it('counts a top level apart from the functions', () => {
    const region = (name: string, kind: string): ReviewRegion => ({
      kind, name, startLine: 1, endLine: 2, reach: 'far', edit: 'modified', changedLineCases: 1, cases: 1, tests: ['test/b.test.ts'], called: [],
    });
    const review = { from: 'a'.repeat(40), record: 'ran', base: 'since', files: [{ file: 'src/a.ts', recorded: true, regions: [region('', 'module'), region('total', 'function')] }] } as unknown as Review;

    expect(formatHandover([{ review }])).toContain('<summary>🧭 Coverage of the changed area: 1 changed function and 1 top level, both reached by a case</summary>');
  });

  it('takes a part one suite never ran as answered by a suite that ran the same code, read with other bounds', () => {
    const part = (kind: string, startLine: number, endLine: number, reach: ReviewRegion['reach'], tests: readonly string[]): ReviewRegion => ({
      kind, name: 'review', startLine, endLine, reach, edit: 'modified', changedLineCases: tests.length, cases: tests.length, tests, called: [],
    });
    const at = (record: string, regions: readonly ReviewRegion[]) =>
      ({ from: 'a'.repeat(40), record, base: 'since', files: [{ file: 'src/a.ts', recorded: true, regions }] }) as unknown as Review;

    const out = formatHandover([
      { suite: 'integration', review: at('before', [part('function', 172, 289, 'unwalked', []), part('continuation', 201, 288, 'unwalked', [])]) },
      { suite: 'unit', review: at('ran', [part('function', 173, 287, 'near', ['test/a.test.ts']), part('continuation', 202, 286, 'near', ['test/a.test.ts'])]) },
    ]);

    expect(out).toContain('1 changed function, reached by a case');
    expect(out).not.toContain('🔴');
  });

  it('names a function a suite ran on the change without a case, though a suite read from before counts it new', () => {
    const region = (reach: ReviewRegion['reach']): ReviewRegion => ({
      kind: 'function', name: 'round', startLine: 5, endLine: 9, reach, edit: 'new', changedLineCases: 0, cases: 0, tests: [], called: [],
    });
    const at = (record: string, reach: ReviewRegion['reach']) =>
      ({ from: 'a'.repeat(40), record, base: 'since', files: [{ file: 'src/a.ts', recorded: true, regions: [region(reach)] }] }) as unknown as Review;

    const out = formatHandover([{ suite: 'browser', review: at('before', 'hole') }, { suite: 'unit', review: at('ran', 'hole') }]);

    expect(out.split('\n').filter((line) => line.startsWith('- '))).toEqual(['- 🔴 `round` in `src/a.ts` — no case (`unit`)']);
    expect(out).toContain('1 changed function, 1 with code no case ran');
  });

  it('takes a suite that ran on the change as the word on what in a file it read is new', () => {
    const at = (record: string, regions: readonly ReviewRegion[]) =>
      ({ from: 'a'.repeat(40), record, base: 'since', files: [{ file: 'src/a.ts', recorded: true, regions }] }) as unknown as Review;
    const moved: ReviewRegion = { kind: 'function', name: 'total', startLine: 20, endLine: 30, reach: 'unwalked', edit: 'new', changedLineCases: 0, cases: 0, tests: [], called: [] };
    const values: ReviewRegion = { kind: 'module', name: '', startLine: 1, endLine: 40, reach: 'near', edit: 'modified', changedLineCases: 3, cases: 3, tests: ['test/a.test.ts'], called: [] };

    const out = formatHandover([{ suite: 'integration', review: at('before', [moved]) }, { suite: 'unit', review: at('ran', [values]) }]);

    expect(out.split('\n').filter((line) => line.startsWith('- '))).toEqual([]);
    expect(out).toContain('<summary>🧭 Coverage of the changed area: no changed function</summary>');
  });

  it('takes a suite that ran on the change as the word on what in a file it read the change touched', () => {
    const at = (record: string, regions: readonly ReviewRegion[]) =>
      ({ from: 'a'.repeat(40), record, base: 'since', files: [{ file: 'src/a.ts', recorded: true, regions }] }) as unknown as Review;
    const region = (name: string, reach: ReviewRegion['reach'], cases: number): ReviewRegion =>
      ({ kind: 'function', name, startLine: name === 'total' ? 20 : 5, endLine: name === 'total' ? 30 : 9, reach, edit: 'modified', changedLineCases: cases, cases, tests: cases === 0 ? [] : ['test/a.test.ts'], called: [] });

    const out = formatHandover([
      { suite: 'integration', review: at('before', [region('total', 'unwalked', 0), region('round', 'hole', 0)]) },
      { suite: 'unit', review: at('ran', [region('round', 'far', 1)]) },
    ]);

    expect(out.split('\n').filter((line) => line.startsWith('- '))).toEqual(['- 🟡 `round` in `src/a.ts` — 1 case, far: `test/a.test.ts` (`unit`)']);
  });

  it('says so when the change touched no function, and why a suite was not read, in one sentence', () => {
    const out = formatHandover([
      { suite: 'unit', review: { from: 'a'.repeat(40), record: 'before', base: 'since', files: [] } as unknown as Review },
      { suite: 'browser', missed: 'the record is behind. Run it again: `yarn test`.' },
    ]);

    expect(out).toContain('<summary>🧭 Coverage of the changed area: no changed function</summary>');
    expect(formatHandover([{ review: { from: 'a'.repeat(40), record: 'ran', base: 'since', files: [{ file: 'src/a.ts', recorded: true, regions: [
      { kind: 'function', name: 'total', startLine: 1, endLine: 2, reach: 'near', edit: 'modified', changedLineCases: 1, cases: 1, tests: ['test/a.test.ts'], called: [] },
    ] }] } as unknown as Review }])).toContain('\n\nEvery one reached by a case: 1 near.\n');
    expect(out).toContain('\n`browser` not read: the record is behind.\n');
    expect(out).not.toContain('every one');
    expect(out).not.toContain('More on one file');
    expect(formatHandover([{ suite: 'unit', missed: 'no record' }])).toContain('<summary>🧭 Coverage of the changed area: no record read</summary>');
  });

  it('says which suites ran on the change and which are read from the record before it', () => {
    const at = (record: string) => ({ from: 'a'.repeat(40), record, base: 'since', files: [] }) as unknown as Review;

    const out = formatHandover([{ suite: 'browser', review: at('before') }, { suite: 'integration', review: at('ran') }, { suite: 'unit', review: at('ran') }]);

    expect(out).toContain('\nRead from the runs on this change for `integration` and `unit`, and from the record before it for the rest.\n');
  });

  it('reads every declared suite when none is named, and says why one could not be read', async () => {
    const { root, first } = await changed({ suites: ['unit', 'browser'] });
    await writeFile(join(root, 'src/total.ts'), `${AFTER}// not run yet\n`);

    const { code, out } = await printed(['--since', first, '--root', root, '--format', 'handover']);

    expect(code).toBe(0);
    expect(out).toContain('<details><summary>🧭 Coverage of the changed area: 2 changed functions, 1 new and not run yet</summary>');
    expect(out).toContain('\nAnd 1 more, every one reached by a case: 1 near.\n');
    expect(out).toMatch(/\n`browser` not read: [^\n]+\.\n/);
  });

  it('reads only the suite it is named', async () => {
    const { root, first } = await changed({ suites: ['unit', 'browser'] });

    const { out } = await printed(['--since', first, '--suite', 'unit', '--root', root, '--format', 'handover']);

    expect(out).toContain('\nRead from the runs of `unit` on this change in this checkout.\n');
    expect(out).not.toContain('`browser`');
  });

  it('fails on the suite it is named when that suite cannot be read', async () => {
    const { root, first } = await changed({ suites: ['unit', 'browser'] });

    const { code, err } = await printed(['--since', first, '--suite', 'browser', '--root', root, '--format', 'handover']);

    expect(code).not.toBe(0);
    expect(err).toContain('browser');
  });

  it('reads a checkout whose suite ran a test file twice at this commit, which leaves no comparable base', async () => {
    const { root, first } = await changed();
    const change = git(root, ['rev-parse', 'HEAD']);
    // The second run at this commit retired the first's cases, recorded over the same tree, so they name no commit.
    const record = testCoverageFile(root);
    const { index } = caseSectionsAt(record);
    await writeFile(record, withCaseSections(await readFile(record), {
      ...(index === undefined ? {} : { index }),
      before: encodeExecutionIndex({ tests: [DISCOUNTS], modules: [{ file: 'src/total.ts', blocks: [block('applyDiscount', 1, 3, [0])] }] }),
      last: Buffer.from(JSON.stringify({ commit: change, at: '2026-10-09T00:00:00.000Z', files: ['test/total.test.ts'], cases: [DISCOUNTS.id] })),
    }));
    await writeFile(commitRunsFile(record), JSON.stringify({
      commit: change, first: '2026-10-09T00:00:00.000Z', latest: '2026-10-09T00:00:00.000Z', runs: 2, files: ['test/total.test.ts'],
    }));
    expect((await printed(['--since', first, '--root', root])).err).toContain('names no commit it was recorded at');

    const { code, out } = await printed(['--since', first, '--root', root, '--format', 'handover']);

    expect(code).toBe(0);
    expect(out).toContain('\nAnd 1 more, every one reached by a case: 1 near.\n');
  });

  it('refuses the flags that read or compare what a run made', () => {
    expect(() => parse(['--format', 'handover', '--from-run', '1'])).toThrow(/--format handover .*--from-run/);
    expect(() => parse(['--format', 'handover', '--out', 'out'])).toThrow(/--format handover .*--out/);
    expect(() => parse(['--format', 'handover', '--coverage'])).toThrow(/--format handover .*--coverage/);
    expect(() => parse(['--format', 'handover', '--against', 'record.bin'])).toThrow(/--format handover .*--against/);
  });
});
