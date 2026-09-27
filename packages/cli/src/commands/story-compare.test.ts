import { describe, expect, it } from 'vitest';
import type { Comparison, Place, StoryEntry } from '@variance-authority/sense/story';
import { parseArgs } from '../bin.js';
import { compareStory, formatComparison } from './story-compare.js';

const REMOVE: Place = { file: 'src/cart.ts', name: 'removeItem', kind: 'function', startLine: 12, endLine: 30 };
const PRICE: Place = { file: 'src/cart.ts', name: 'price', kind: 'function', startLine: 32, endLine: 36 };

const COMPARISON: Comparison = {
  file: 'src/cart.test.ts',
  name: 'cart > removes the last item',
  sides: [{ name: 'passed', readings: 3, stopped: 0 }, { name: 'threw', readings: 2, stopped: 2 }],
  places: [
    { side: 'passed', items: [{ place: REMOVE, path: 'for#0/body/if#0/then', startLine: 19, endLine: 19, constructLine: 19 }] },
    { side: 'threw', items: [] },
  ],
  said: [{ side: 'passed', items: [] }, { side: 'threw', items: ['console.log stock 0'] }],
  reversed: [[{ said: 'eyes click on button "Save" in SaveBar' }, { place: PRICE }]],
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
    const checkout: Place = { file: 'src/checkout.ts', name: 'checkout', kind: 'function', startLine: 10, endLine: 16 };
    const arms: Comparison = {
      ...COMPARISON,
      places: [
        { side: 'passed', items: [{ place: checkout, path: 'if#0/else', startLine: 15, endLine: 15, constructLine: 13 }] },
        { side: 'threw', items: [{ place: checkout, path: 'if#0/then', startLine: 13, endLine: 15, constructLine: 13 }] },
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
      places: [{ side: 'slow', items: [] }, { side: 'fast', items: [] }],
      said: [{ side: 'slow', items: [] }, { side: 'fast', items: [] }],
      reversed: [],
      unsteady: { places: 0, said: 0, order: 0 },
      single: true,
    };
    expect(formatComparison(none, 'text').split('\n')).toEqual([
      'compare  src/cart.test.ts > cart > removes the last item',
      '  slow (1 reading) against fast (2 readings, 1 threw)',
      '  one reading on a side: what differs below may be a run that went another way, not the side;',
      '  run the case again under each label, or until it has passed and thrown more than once',
      '',
      '  nothing separates the sides: whatever differs between them differs between readings of one side too',
      '',
    ]);
  });

  it('names what a side is missing before reading anything', () => {
    expect(() => compareStory('/checkout', [entry(undefined, false)], 'last')).toThrow(
      '--compare last needs two readings of this case, and 1 is kept; run it again',
    );
    expect(() => compareStory('/checkout', [entry(undefined, false), entry(undefined, false)], 'outcome')).toThrow(
      '--compare outcome needs readings that passed and readings that threw, and of 2 kept 2 passed and 0 threw; run the case until it has done both',
    );
    expect(() => compareStory('/checkout', [entry('slow'), entry(undefined)], { labels: ['slow', 'fast'] })).toThrow(
      'no reading of this case is labelled fast; the labels kept are 1, slow',
    );
  });

  it('takes the sides from --compare, and refuses a zoom or a label beside it', () => {
    expect(parseArgs(['story', '--compare', 'outcome'])).toMatchObject({ command: 'story', compare: 'outcome' });
    expect(parseArgs(['story', '--compare', '1,slow'])).toMatchObject({ compare: { labels: ['1', 'slow'] } });
    expect(parseArgs(['story', '--label', 'slow'])).toMatchObject({ label: 'slow' });
    expect(() => parseArgs(['story', '--compare', 'slow'])).toThrow('--compare takes last, outcome, or two labels as <a>,<b>, not `slow`');
    expect(() => parseArgs(['story', '--compare', 'last', '--whole'])).toThrow('--compare reads no route, so --whole has nothing to narrow');
    expect(() => parseArgs(['story', '--compare', 'last', '--label', 'slow'])).toThrow('--label picks the reading to read');
  });
});
