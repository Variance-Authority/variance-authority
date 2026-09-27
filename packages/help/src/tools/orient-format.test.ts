import { describe, expect, it } from 'vitest';
import type { CasesEntered, OrientFlows, OrientPackage, Orientation } from '@variance-authority/sense';
import { followUps, formatOrientation, percent, type OrientReading } from './orient-format.js';

/**
 * The words of `variance ask orient`, held without a repository: every number
 * below is one the addon would have handed over, so what is pinned is the order,
 * the alignment, and the line each absent reading is replaced by.
 */

const NONE: OrientFlows = { rows: [], more: 0, moreShare: 0, units: 0, unread: 0 };

const ORIENTATION: Orientation = {
  owners: [
    { package: '@t/checkout', directory: 'packages/checkout', indexed: true },
    { package: '@t/cart', directory: 'packages/cart', indexed: true },
    { indexed: false },
    { indexed: false },
  ],
  packages: [
    {
      package: '@t/checkout',
      directory: 'packages/checkout',
      indexed: 10,
      takes: {
        rows: [{ package: '@t/cart', directory: 'packages/cart', share: 0.75, names: [{ name: 'priceOf', share: 0.5 }, { name: 'currency', share: 0.25 }], moreNames: 0 }],
        more: 1,
        moreShare: 0.25,
        units: 4,
        unread: 0,
      },
      taken: NONE,
    },
    {
      package: '@t/cart',
      directory: 'packages/cart',
      indexed: 5,
      takes: NONE,
      taken: {
        rows: [
          { package: '@t/checkout', directory: 'packages/checkout', share: 0.996, names: [{ name: 'priceOf', share: 0.5 }, { name: '*', share: 0.004 }], moreNames: 3 },
          { share: 0.004, names: [{ name: 'default', share: 0.004 }], moreNames: 0 },
        ],
        more: 0,
        moreShare: 0,
        units: 250,
        unread: 2,
      },
    },
  ],
  records: 40,
  stale: 2,
  unread: 0,
  dropped: 0,
};

const READING: OrientReading = {
  query: 'price total',
  words: ['price', 'total'],
  matched: 5,
  shown: [
    { file: 'packages/checkout/src/total.ts', words: 2, lines: 12 },
    { file: 'packages/cart/src/price.ts', words: 1, lines: 3 },
    { file: 'README.md', words: 1, lines: 1 },
    { file: 'test/total.test.ts', words: 1, lines: 1 },
  ],
  around: { index: '/cache/source-index.bin', orientation: ORIENTATION },
  recorded: [
    {
      suite: 'unit',
      recording: '/cache/suites/unit/coverage.bin.cases.bin',
      files: [
        {
          file: 'packages/checkout/src/total.ts',
          cases: 5,
          loaded: true,
          titles: [{ file: 'test/total.test.ts', name: 'adds tax' }],
          declaredNames: [],
        },
        { file: 'packages/cart/src/price.ts', cases: 0, loaded: true, titles: [], declaredNames: [] },
        { file: 'README.md', titles: [], declaredNames: [] },
        { file: 'test/total.test.ts', titles: [], declared: 3, declaredNames: ['adds tax'] },
      ],
    },
    { suite: 'stories', recording: '/cache/suites/stories/coverage.bin.cases.bin', unread: 'nothing is recorded there' },
  ],
};

describe('an orientation, said', () => {
  it('reads as the files, the packages around them, the cases that ran them, and the questions to ask next', () => {
    expect(formatOrientation(READING)).toBe(
      [
        '5 tracked files contain one of the words `price total`. The 4 files with the most of them, then the most matching lines:',
        '',
        '  packages/checkout/src/total.ts  2 words, 12 lines  @t/checkout',
        '  packages/cart/src/price.ts      1 word, 3 lines    @t/cart',
        '  README.md                       1 word, 1 line     no package',
        '  test/total.test.ts              1 word, 1 line     no package',
        '',
        '1 more file not shown.',
        '',
        'Packages, from the source index at /cache/source-index.bin (40 files indexed; 2 changed or removed since).',
        "A use is one file importing one name from another package. A package's share is of the uses on that side; " +
          "a name's share is of every use the package exporting it gets from outside.",
        '`variance index` updates the index.',
        '',
        '@t/checkout  packages/checkout',
        '  Takes from, 2 packages, 4 uses:',
        '     75%  @t/cart  priceOf 50%, currency 25%',
        '     25%  1 more package',
        '  Used by: no package in this checkout.',
        '',
        '@t/cart  packages/cart',
        '  Takes from: no package in this checkout.',
        '  Used by, 2 packages, 250 uses (the imported names of 2 files were not read):',
        '    100%  @t/checkout          priceOf 50%, the whole module <1%, 3 more names',
        '     <1%  files in no package  default <1%',
        '',
        'Recorded cases, suite unit, from /cache/suites/unit/coverage.bin.cases.bin:',
        '  packages/checkout/src/total.ts  5 cases ran it, and it also ran while its module evaluated*:',
        '      test/total.test.ts > adds tax',
        '      4 more cases.',
        '  packages/cart/src/price.ts      ran only while its module evaluated.*',
        '  README.md                       not recorded: the recording has no row for this file.',
        '  test/total.test.ts              a test file declaring 3 recorded cases:',
        '      adds tax',
        '      2 more cases.',
        '  * The recording names no case for what runs while a module evaluates. The cases whose files import the module ran it, ' +
          'and `variance covering --file` names them.',
        '',
        'Recorded cases, suite stories: none read from /cache/suites/stories/coverage.bin.cases.bin, nothing is recorded there. A run with `withTestSelection` records them.',
        '',
        'Narrower questions:',
        '  variance ask uses --name priceOf --package @t/cart',
        '  variance ask symbol --name priceOf --package @t/cart',
        "  variance ask search --query 'price total' --from packages/checkout/src/total.ts",
        '  variance covering --file packages/checkout/src/total.ts --suite unit',
      ].join('\n'),
    );
  });

  it('leaves the packages out, saying which command publishes them, when no index was published', () => {
    const text = formatOrientation({ ...READING, around: { index: '/cache/source-index.bin' } });

    expect(text).toContain('Packages: no source index is published at /cache/source-index.bin. `variance index` publishes one.');
    expect(text).toContain('  packages/cart/src/price.ts      1 word, 3 lines\n');
    // No start point is known to be indexed, so no question with `--from` is offered.
    expect(text).not.toContain('--from');
  });

  it('says so in one line when no file contains the words, and asks nothing further', () => {
    const text = formatOrientation({ ...READING, matched: 0, shown: [], around: { index: '/cache/source-index.bin' }, recorded: [] });

    expect(text).toBe('No tracked file contains any of the words `price total`.');
  });

  it('says no case ran a file only when no region of it ran, and points at the loaders of one that only loaded', () => {
    const recorded = (entered: CasesEntered) => [{ recording: '/cache/cases.bin', files: [entered] }];
    const idle = formatOrientation({ ...READING, recorded: recorded({ file: 'src/idle.ts', cases: 0, loaded: false, titles: [], declaredNames: [] }) });
    const loaded = { ...READING, recorded: recorded({ file: 'src/flags.ts', cases: 0, loaded: true, titles: [], declaredNames: [] }) };

    expect(idle).toContain('  src/idle.ts  recorded, and no case ran it.\n');
    expect(idle).not.toContain('* The recording names no case');
    expect(formatOrientation(loaded)).toContain('  src/flags.ts  ran only while its module evaluated.*\n');
    expect(followUps(loaded)).toContain('variance covering --file src/flags.ts');
  });

  it('says an empty side was not read rather than that nobody uses the package, when it was not', () => {
    const [checkout] = ORIENTATION.packages;
    const unindexed = { ...checkout!, indexed: 0, takes: NONE };
    const unread = { ...checkout!, taken: { ...NONE, unread: 3 } };
    const say = (one: OrientPackage) => formatOrientation({ ...READING, around: { index: '', orientation: { ...ORIENTATION, packages: [one] } } });

    expect(say(unindexed)).toContain("  Takes from: not read. None of this package's files is in the index.\n");
    expect(say(unread)).toContain('  Used by: none counted. The imported names of 3 files were not read.\n');
  });

  it('asks about a name only when one is there to ask about', () => {
    const quiet = { ...ORIENTATION, packages: [{ ...ORIENTATION.packages[0]!, takes: NONE }] };

    expect(followUps({ ...READING, around: { index: '', orientation: quiet }, recorded: [] })).toEqual([
      "variance ask search --query 'price total' --from packages/checkout/src/total.ts",
    ]);
  });

  it('says a share too small to round as less than one percent, never as none', () => {
    expect([percent(0), percent(0.004), percent(0.005), percent(1)]).toEqual(['0%', '<1%', '1%', '100%']);
  });
});
