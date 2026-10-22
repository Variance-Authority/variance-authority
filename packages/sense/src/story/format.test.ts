import { describe, expect, it } from 'vitest';

/** The format as it ships: built, because it `require`s its neighbours by the names the build gives them. */
const { decodeStory, encodeStory } = (await import('../../dist/story/format.cjs')).default as typeof import('./format.cjs');

const KEY = 'src/theme.test.ts\u0000shows the theme\u00001';

/** A tape of one case over two modules, after the tape was started again once the file loaded. */
function tape(notes: [number, string, string][]) {
  return {
    tape: Int32Array.from([0, 1]), taped: 2, visits: 2, at: [0], keys: [KEY], notes, unnoted: 0,
    rows: { ids: ['src/theme.ts', 'src/unvisited.ts'], counts: [2, 1], bases: [0, 2] },
    held: new Map([
      ['src/theme.ts', 'holds Theme=ref1 react.context'],
      ['src/unvisited.ts', 'holds never=ref2 Object'],
    ]),
  };
}

describe('what a story says a module holds', () => {
  it('opens each case with what every module it went through held when it loaded', () => {
    const story = decodeStory(encodeStory(tape([[1, KEY, 'handed theme=ref3 Object']]), KEY));

    expect(story.beforeNotes).toEqual([[0, 'holds Theme=ref1 react.context']]);
    expect(story.notes).toEqual([[1, 'handed theme=ref3 Object']]);
  });

  it('says it once when the module loaded inside the case', () => {
    const story = decodeStory(encodeStory(tape([[0, KEY, 'holds Theme=ref1 react.context']]), KEY));

    expect(story.beforeNotes).toEqual([]);
    expect(story.notes).toEqual([[0, 'holds Theme=ref1 react.context']]);
  });
});
