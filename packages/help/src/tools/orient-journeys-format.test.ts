import { describe, expect, it } from 'vitest';
import type { JourneysAround, JourneysFile, JourneysFlows } from '@variance-authority/sense';
import { formatOrientation } from './orient-format.js';
import { formatJourneys } from './orient-journeys-format.js';
import { asksOf } from './orient.js';

/**
 * The journeys part of `variance ask orient`, held without a repository: every
 * number below is one the addon would have handed over, so what is pinned is
 * the wording, the order, and the line an unprepared suite is replaced by.
 */

const FLOWS: JourneysFlows = {
  package: '@t/cart',
  through: 7,
  distinct: 2,
  top: [
    { cases: 5, packages: ['@t/checkout', '@t/cart'], exampleFile: 'test/total.test.ts', exampleName: 'adds tax' },
    { cases: 2, packages: ['@t/cart', null], exampleFile: 'test/price.test.ts', exampleName: 'rounds' },
  ],
};

const EMPTY = { blocks: [], moreBlocks: 0, callers: [], moreCallers: 0, goes: [], moreGoes: 0, writtenSince: false } as const;

const WHOLE: JourneysFile = {
  ...EMPTY,
  file: 'packages/cart/src/price.ts',
  recorded: true,
  blocks: [
    { name: 'priceOf', kind: 'function', line: 3, end: 9, cases: 12 },
    { name: 'round', kind: 'function', line: 11, end: 11, cases: 4 },
  ],
  moreBlocks: 1,
  callers: [
    { name: 'total', file: 'packages/checkout/src/total.ts', line: 4, at: 'priceOf', cases: 10, known: 'observed' },
    { cases: 2, at: 'round', known: 'static' },
  ],
  moreCallers: 3,
  goes: [{ name: 'taxOf', file: 'packages/tax/src/rate.ts', line: 1, at: 'priceOf', cases: 12, known: 'name-match' }],
  flows: FLOWS,
};

const LINE: JourneysFile = {
  ...EMPTY,
  file: 'packages/cart/src/price.ts',
  line: 6,
  recorded: true,
  changed: true,
  atCommit: 5,
  focus: {
    name: 'priceOf',
    kind: 'function',
    line: 3,
    end: 9,
    cases: 12,
    loaded: true,
    placedIn: 10,
    callers: [{ name: 'total', file: 'packages/checkout/src/total.ts', line: 4, cases: 10, known: 'observed' }],
    moreCallers: 0,
    goes: [],
    moreGoes: 0,
    inner: [{ name: 'priceOf/scale', kind: 'function', line: 5, end: 7, cases: 12 }],
    moreInner: 0,
  },
  holding: { name: 'priceOf', kind: 'branch', line: 6, end: 7, cases: 3 },
  flows: FLOWS,
};

const ANSWER: JourneysAround = {
  answer: {
    cases: 20,
    commit: 'ce8164c7df8cd7dea00bc8d1c7c8c5a74c263a04',
    files: [
      WHOLE,
      LINE,
      { ...EMPTY, file: 'packages/cart/src/price.ts', line: 40, recorded: true, writtenSince: true, changed: true, flows: FLOWS },
      { ...EMPTY, file: 'README.md', recorded: false, flows: { through: 0, distinct: 0, top: [] } },
    ],
  },
};

describe('the journeys around some files, said', () => {
  it('reads as the functions the cases ran, the calls across the file, how each is known, and the package flows', () => {
    const [blank, heading, known, ...rest] = formatJourneys([ANSWER]);

    expect(blank).toBe('');
    expect(heading).toBe('Journeys, from the recording at commit ce8164c7df8c, 20 cases walked over the static call graph:');
    expect(known).toMatch(/^Each call says how it is known: observed, the call site ran in those cases; /u);
    expect(rest.join('\n')).toBe(
      [
        '  packages/cart/src/price.ts',
        '    Functions the most cases ran:',
        '      12  priceOf  lines 3–9',
        '       4  round  line 11',
        '      1 more function.',
        '    Called from other files:',
        '      10  total  packages/checkout/src/total.ts:4 → priceOf  observed',
        '       2  the test case → round  static',
        '      3 more callers.',
        '    Calls into other files:',
        '      12  priceOf → taxOf  packages/tax/src/rate.ts:1  inferred, by name',
        '    7 of 20 cases (35%) run through @t/cart, along 2 distinct package flows; the 2 most taken, each with a case that takes it:',
        '      5  @t/checkout → @t/cart  (test/total.test.ts > adds tax)',
        '      2  @t/cart → no package  (test/price.test.ts > rounds)',
        '  packages/cart/src/price.ts:6  in priceOf (lines 3–9), which 12 cases ran; the line is in a branch (lines 6–7) that 3 cases ran. ' +
          'The file changed since the recording; this was line 5 then.',
        '    It also ran while its module evaluated.',
        '    Called from, a caller is found in 10 of its 12 cases:',
        '      10  total  packages/checkout/src/total.ts:4  observed',
        '    Calls: none found.',
        '    Functions written inside it that cases ran:',
        '      12  priceOf/scale  lines 5–7',
        '    Package flows: as above.',
        '  packages/cart/src/price.ts:40  was written after the recording, so no recorded case ran it. The file changed since the recording.',
        '    Package flows: as above.',
        '  README.md  the recording has no function in this file.',
      ].join('\n'),
    );
  });

  it('says why a suite has no journeys in one line, and explains how calls are known only once', () => {
    const text = formatJourneys([
      { suite: 'unit', answer: { notPrepared: 'the recording changed after they were prepared', cases: 0, files: [] } },
      { suite: 'stories', answer: ANSWER.answer },
      { suite: 'e2e', answer: ANSWER.answer },
    ]).join('\n');

    expect(text).toContain(
      '\nJourneys, suite unit: not prepared: the recording changed after they were prepared. `variance index` prepares them from the latest recording.\n',
    );
    expect(text.split('Each call says how it is known').length).toBe(2);
  });

  it('sits between the recorded cases and the narrower questions of the whole answer', () => {
    const text = formatOrientation({
      files: ['README.md'],
      around: { index: '/cache/source-index.bin' },
      recorded: [{ recording: '/cache/cases.bin', unread: 'nothing is recorded there' }],
      journeys: [{ answer: { notPrepared: 'there is no recording to walk', cases: 0, files: [] } }],
    });

    expect(text.endsWith(
      'A run with `withTestSelection` records them.\n\nJourneys: not prepared: there is no recording to walk. `variance index` prepares them from the latest recording.',
    )).toBe(true);
  });

  it('reads a trailing `:<line>` as the line asked about, and anything else as the path', () => {
    expect(asksOf(['src/a.ts:12', 'src/b.ts', 'c:/x.ts', 'src/d.ts:'])).toEqual([
      { file: 'src/a.ts', line: 12 },
      { file: 'src/b.ts' },
      { file: 'c:/x.ts' },
      { file: 'src/d.ts:' },
    ]);
  });
});
