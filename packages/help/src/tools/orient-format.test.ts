import { describe, expect, it } from 'vitest';
import type { CasesEntered, OrientFlows, OrientPackage, Orientation } from '@variance-authority/sense';
import { followUps, formatOrientation, percent, type OrientReading } from './orient-format.js';

/**
 * What `variance ask orient` says, held without a repository: every number
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
  files: ['packages/checkout/src/total.ts', 'packages/cart/src/price.ts', 'README.md', 'test/total.test.ts'],
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
          loaders: 3,
          titles: [{ file: 'test/total.test.ts', name: 'adds tax' }],
          declaredNames: [],
        },
        {
          file: 'packages/cart/src/price.ts',
          cases: 2,
          loaded: true,
          loaders: 2,
          titles: [{ file: 'test/cart.test.ts', name: 'prices a line' }],
          declaredNames: [],
        },
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
        '4 files asked about:',
        '  packages/checkout/src/total.ts  @t/checkout',
        '  packages/cart/src/price.ts      @t/cart',
        '  README.md                       not in the source index',
        '  test/total.test.ts              not in the source index',
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
        '  packages/checkout/src/total.ts  5 cases ran it, 3 of them by importing it:',
        '      test/total.test.ts > adds tax',
        '      4 more cases.',
        '  packages/cart/src/price.ts      2 cases ran it, all of them by importing it:',
        '      test/cart.test.ts > prices a line',
        '      1 more case.',
        '  README.md                       not recorded: the recording has no row for this file.',
        '  test/total.test.ts              a test file declaring 3 recorded cases:',
        '      adds tax',
        '      2 more cases.',
        '',
        'Recorded cases, suite stories: none read from /cache/suites/stories/coverage.bin.cases.bin, nothing is recorded there. A run with `withTestSelection` records them.',
        '',
        'Narrower questions:',
        '  variance ask uses --name priceOf --package @t/cart',
        '  variance ask symbol --name priceOf --package @t/cart',
        '  variance covering --file packages/checkout/src/total.ts --suite unit',
      ].join('\n'),
    );
  });

  it('leaves the packages out, saying which command publishes them, when no index was published', () => {
    const text = formatOrientation({ ...READING, around: { index: '/cache/source-index.bin' } });

    expect(text).toContain('Packages: no source index is published at /cache/source-index.bin. `variance index` publishes one.');
    // Every file asked about is still said, with nothing claimed about its package.
    expect(text).toContain('4 files asked about:\n  packages/checkout/src/total.ts\n  packages/cart/src/price.ts\n  README.md\n');
    expect(text).not.toContain('not in the source index');
  });

  it('says a file with no package as that, and one the index does not hold as that, never dropping either', () => {
    const owners = [{ indexed: true }, { indexed: false }];
    const text = formatOrientation({
      files: ['scripts/build.ts', 'src/new.ts'],
      around: { index: '', orientation: { ...ORIENTATION, owners, packages: [] } },
      recorded: [],
    });

    expect(text).toContain('2 files asked about:\n  scripts/build.ts  no package\n  src/new.ts        not in the source index\n');
  });

  it('says no case ran a file only when no region of it ran, and what the importers could not name for one that only loaded', () => {
    const recorded = (entered: CasesEntered) => [{ recording: '/cache/cases.bin', files: [entered] }];
    const idle = formatOrientation({ ...READING, recorded: recorded({ file: 'src/idle.ts', cases: 0, loaded: false, titles: [], declaredNames: [] }) });
    const loaded = { ...READING, recorded: recorded({ file: 'src/flags.ts', cases: 0, loaded: true, titles: [], declaredNames: [] }) };
    const nobody = recorded({ file: 'src/flags.ts', cases: 0, loaded: true, loaders: 0, titles: [], declaredNames: [] });

    expect(idle).toContain('  src/idle.ts  recorded, and no case ran it.\n');
    expect(formatOrientation(loaded)).toContain(
      '  src/flags.ts  ran only while its module evaluated, and the source index names no importers to read the cases from.\n',
    );
    expect(formatOrientation({ ...READING, recorded: nobody })).toContain(
      '  src/flags.ts  ran only while its module evaluated, and no recorded case imports it.\n',
    );
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

    expect(followUps({ ...READING, around: { index: '', orientation: quiet }, recorded: [] })).toEqual([]);
  });

  it('says a share too small to round as less than one percent, never as none', () => {
    expect([percent(0), percent(0.004), percent(0.005), percent(1)]).toEqual(['0%', '<1%', '1%', '100%']);
  });

  it('keeps external import evidence apart from declarations and says when the index is incomplete', () => {
    const text = formatOrientation({
      ...READING,
      external: {
        index: '/cache/source-index.bin',
        orientation: {
          dependencies: [{
            package: 'state-kit', files: 1, imports: 1, moreSites: 0,
            declaredIn: ['root package.json'],
            sites: [{ file: 'packages/checkout/src/total.ts', line: 4, specifier: 'state-kit', kind: 'imports', names: ['createStore'], distance: 0 }],
          }],
          more: 0, reached: 2, unread: 1, stale: 0, missing: [],
          declaredOnly: ['other-kit'], moreDeclaredOnly: 0, dropped: 0,
        },
      },
    });
    expect(text).toContain('External packages requested along local imports from these files (2 source files reached):');
    expect(text).toContain('state-kit — 1 file, 1 request; declared in root package.json');
    expect(text).toContain('packages/checkout/src/total.ts:4  state-kit (createStore; 0 local imports away)');
    expect(text).toContain('Declared locally without import evidence along this path: other-kit.');
    expect(text).toContain('Incomplete reading: 1 unread');
  });
});
