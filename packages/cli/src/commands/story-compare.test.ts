import { describe, expect, it } from 'vitest';
import type { Comparison, OutcomeComparison, Place, StoryEntry } from '@variance-authority/sense/story';
import { parseArgs } from '../bin.js';
import { compareStory, formatComparison, formatOutcomes } from './story-compare.js';

const REMOVE: Place = { file: 'src/cart.ts', name: 'removeItem', kind: 'function', at: 'src/cart.ts#removeItem/entry', startLine: 12, endLine: 30 };
const PRICE: Place = { file: 'src/cart.ts', name: 'price', kind: 'function', at: 'src/cart.ts#price/entry', startLine: 32, endLine: 36 };

const COMPARISON: Comparison = {
  file: 'src/cart.test.ts',
  name: 'cart > removes the last item',
  sides: [{ name: 'passed', readings: 3, stopped: 0 }, { name: 'threw', readings: 2, stopped: 2 }],
  only: [
    { sides: ['passed'], places: [{ place: REMOVE, path: 'for#0/body/if#0/then', startLine: 19, endLine: 19, constructLine: 19 }], said: [] },
    { sides: ['threw'], places: [], said: ['console.log stock 0'] },
  ],
  orders: [{ pair: [{ said: 'eyes click on button "Save" in SaveBar' }, { place: PRICE }], before: ['passed'], after: ['threw'] }],
  unsteady: { places: 1, said: 4, order: 37 },
  single: false,
};

const entry = (label: string | undefined, stopped?: boolean): StoryEntry => ({
  path: '/nowhere.story',
  file: 'src/cart.test.ts',
  name: 'cart > removes the last item',
  visits: 4,
  ...(label === undefined ? {} : { label }),
  ...(stopped === undefined ? {} : { stopped }),
});

describe('readings of one case compared', () => {
  it('prints what holds on every reading of one side and none of the other, and counts what moves within a side', () => {
    expect(formatComparison(COMPARISON, 'text')).toBe(`${[
      'compare  src/cart.test.ts > cart > removes the last item',
      '  passed (3 readings) against threw (2 readings, every one threw)',
      '',
      '  only when it passed, on every reading:',
      '    went into  removeItem  src/cart.ts:12-30, the then of the if on 19',
      '',
      '  only when it threw, on every reading:',
      '    said       » console.log stock 0',
      '',
      '  in the opposite order when it passed and when it threw, on every reading:',
      '    » eyes click on button "Save" in SaveBar',
      '      before price  src/cart.ts:32-36 when it passed, after it when it threw',
      '',
      '  left out, because they differ between readings of one side as well: 1 place, 4 lines said, 37 pairs in changing order',
    ].join('\n')}\n`);
    expect(JSON.parse(formatComparison(COMPARISON, 'json'))).toEqual({ comparison: COMPARISON });
  });

  it('names both arms of an `if` by the line the `if` is named by, not by the line the `else` an absent one is given starts on', () => {
    const checkout: Place = { file: 'src/checkout.ts', name: 'checkout', kind: 'function', at: 'src/checkout.ts#checkout/entry', startLine: 10, endLine: 16 };
    const arms: Comparison = {
      ...COMPARISON,
      only: [
        { sides: ['passed'], places: [{ place: checkout, path: 'if#0/else', startLine: 15, endLine: 15, constructLine: 13 }], said: [] },
        { sides: ['threw'], places: [{ place: checkout, path: 'if#0/then', startLine: 13, endLine: 15, constructLine: 13 }], said: [] },
      ],
    };
    const text = formatComparison(arms, 'text').split('\n');
    expect(text).toContain('    went into  checkout  src/checkout.ts:10-16, the else of the if on 13');
    expect(text).toContain('    went into  checkout  src/checkout.ts:10-16, the then of the if on 13');
  });

  it('says when nothing separates the sides, and when one reading on a side cannot tell a side from a run', () => {
    const none: Comparison = {
      ...COMPARISON,
      sides: [{ name: 'slow', readings: 1, stopped: 0 }, { name: 'fast', readings: 2, stopped: 1 }],
      only: [],
      orders: [],
      unsteady: { places: 0, said: 0, order: 0 },
      single: true,
    };
    expect(formatComparison(none, 'text').split('\n')).toEqual([
      'compare  src/cart.test.ts > cart > removes the last item',
      '  slow (1 reading) against fast (2 readings, 1 threw)',
      '  one reading on a side: what differs below may be a run that went another way, not the side',
      '',
      '  nothing separates the sides: whatever differs between them differs between readings of one side too',
      '',
    ]);
  });

  it('draws the side there is when the other holds no reading, and says which is missing', () => {
    const passed = entry(undefined, false);
    const slow = entry('slow');
    expect(compareStory('/checkout', [passed], 'last')).toEqual({
      alone: passed,
      unmatched: 'nothing to compare it with: this is the only reading of this case kept',
    });
    expect(compareStory('/checkout', [passed, entry(undefined, false)], 'outcome')).toEqual({
      alone: passed,
      unmatched: 'nothing to compare it with: every one of the 2 readings kept passed, and none threw',
    });
    const threw = entry(undefined, true);
    expect(compareStory('/checkout', [threw], 'outcome')).toEqual({
      alone: threw,
      unmatched: 'nothing to compare it with: the one reading kept threw, and none passed',
    });
    expect(compareStory('/checkout', [entry(undefined), slow], { labels: ['slow', 'fast'] })).toEqual({
      alone: slow,
      unmatched: 'nothing to compare it with: no reading of this case is labelled fast; the labels kept are 1, slow',
    });
  });

  it('takes the sides from --compare, and refuses a zoom or a label beside it', () => {
    expect(parseArgs(['story', '--compare', 'outcome'])).toMatchObject({ command: 'story', compare: 'outcome' });
    expect(parseArgs(['story', '--compare', '1,slow'])).toMatchObject({ compare: { labels: ['1', 'slow'] } });
    expect(parseArgs(['story', '--label', 'slow'])).toMatchObject({ label: 'slow' });
    expect(() => parseArgs(['story', '--compare', 'slow'])).toThrow('--compare takes last, outcome, or two labels or more as <a>,<b>,…, not `slow`');
    expect(() => parseArgs(['story', '--compare', 'last', '--whole'])).toThrow('--compare reads no route, so --whole has nothing to narrow');
    expect(() => parseArgs(['story', '--compare', 'last', '--label', 'slow'])).toThrow('--label picks the reading to read');
  });
});

describe('outcomes of one case compared from the record', () => {
  const page = { file: 'src/page.ts', startLine: 3, endLine: 5 };
  const OUTCOMES: OutcomeComparison = {
    file: 'test/page.test.ts',
    name: 'clicks',
    passed: 2,
    threw: 2,
    onlyPassed: [{ ...page, name: 'wire', path: 'entry' }],
    onlyThrew: [],
    moved: [{ region: { ...page, name: 'wire', path: 'entry' }, passed: { line: 4 }, threw: { line: 6 } }],
    unsteady: 3,
    single: false,
  };

  it('prints each region by how its charge moved with the outcome, and counts what moves within one', () => {
    expect(formatOutcomes(OUTCOMES, 'text')).toBe(`${[
      'compare  test/page.test.ts > clicks, from the readings the record keeps',
      '  passed (2 runs) against threw (2 runs)',
      '',
      '  charged to a later line when it threw, on every run:',
      '    wire  src/page.ts:3-5  line 4 when it passed, line 6 when it threw',
      '',
      '  reached only when it passed, on every run:',
      '    wire  src/page.ts:3-5',
      '',
      '  left out, because they differ between runs of one outcome as well: 3 regions',
    ].join('\n')}\n`);
  });

  it('says nothing separates the outcomes, and warns of a side read once', () => {
    const text = formatOutcomes({ ...OUTCOMES, threw: 1, onlyPassed: [], moved: [], unsteady: 0, single: true }, 'text');

    expect(text).toContain('one run on a side');
    expect(text).toContain('nothing separates the outcomes');
  });
});
