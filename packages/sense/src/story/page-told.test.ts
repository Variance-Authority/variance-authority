import { afterEach, describe, expect, it } from 'vitest';
import { TELLER_GLOBAL } from '../test-selection/execution-global.js';
import type { PageStory } from './page-story.js';

/** Built, as `format.test.ts` reads it: the format `require`s its neighbours by the names the build gives them. */
const { pageTellerSource } = (await import('../../dist/story/page-told.js')) as typeof import('./page-told.js');
const { decodeStory, encodeStory } = (await import('../../dist/story/format.cjs')).default as typeof import('./format.cjs');
const storyTap = (await import('../../dist/instrument/story-tap.cjs')).default as typeof import('../instrument/story-tap.cjs');

interface Teller {
  add(story: PageStory): void;
  tell(journey: string): string | undefined;
}

/** The teller as a page gets it: the script alone, run in the realm. */
function teller(): Teller {
  new Function(pageTellerSource())();
  return (globalThis as unknown as Record<string, Teller>)[TELLER_GLOBAL]!;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[TELLER_GLOBAL];
});

const CART = 'src/cart.ts@1';
const PAY = 'src/pay.ts@1';

function drained(story: Partial<PageStory> & Pick<PageStory, 'tape'>): PageStory {
  return {
    taped: story.tape.length, visits: story.tape.length, notes: [], lines: [], unnoted: 0, held: [],
    rows: { ids: [CART], counts: [3], bases: [0] }, ...story,
  };
}

describe('a page that tells what an execution ran', () => {
  it('tells the drains since it last told, end to end, under the execution, and nothing a module holds', () => {
    const page = teller();
    page.add(drained({ tape: [0, 1], notes: [[0, 'holds cart=ref1 Object'], [1, 'console.log adding']], held: [[CART, 'holds cart=ref1 Object']] }));
    page.add(drained({ tape: [3], visits: 2, notes: [[1, 'handed id=7']], rows: { ids: [CART, PAY], counts: [3, 1], bases: [0, 3] } }));

    const told = page.tell('7f3a');

    const tape = {
      tape: Int32Array.from([0, 1, 3]), taped: 3, visits: 4, at: [0], keys: ['7f3a'], lines: [], unnoted: 0, held: new Map(),
      notes: [[1, '7f3a', 'console.log adding'], [3, '7f3a', 'handed id=7']] as const,
      rows: { ids: [CART, PAY], counts: [3, 1], bases: [0, 3] },
    };
    // One encoder: the page's bytes are the ones a head writes for the same tape.
    expect(told).toBe(encodeStory(tape as never, '7f3a').toString('base64'));
    expect(decodeStory(Buffer.from(told!, 'base64'))).toMatchObject({ file: '7f3a', name: '', untaped: 1, beforeNotes: [] });
  });

  it('tells nothing of an execution that ran nothing since it last told', () => {
    const page = teller();
    expect(page.tell('7f3a')).toBeUndefined();
    page.add(drained({ tape: [0] }));
    expect(page.tell('7f3a')).toBeDefined();
    expect(page.tell('7f3a')).toBeUndefined();
  });

  it('keeps what a live head keeps of one execution, and counts the rest', () => {
    const page = teller();
    const notes = Array.from({ length: storyTap.PART_NOTES + 2 }, (_, at): [number, string] => [0, `console.log ${at}`]);
    page.add(drained({ tape: Array.from({ length: storyTap.PART_LIMIT }, () => 0), notes }));
    page.add(drained({ tape: [1, 2], unnoted: 1 }));

    const story = decodeStory(Buffer.from(page.tell('7f3a')!, 'base64'));

    expect(story.visits).toHaveLength(storyTap.PART_LIMIT);
    expect(story.untaped).toBe(2);
    expect(story.notes).toHaveLength(storyTap.PART_NOTES);
    expect(story.unnoted).toBe(3);
  });
});
