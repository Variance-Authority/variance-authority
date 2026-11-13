import { describe, expect, it } from 'vitest';

/** The format as it ships: built, because it `require`s its neighbours by the names the build gives them. */
const { caseStem, decodeStory, encodeStory } = (await import('../../dist/story/format.cjs')).default as typeof import('./format.cjs');

const KEY = 'src/theme.test.ts\u0000shows the theme\u00001';

/** A tape of one case over two modules, after the tape was started again once the file loaded. */
function tape(notes: [number, string, string][], lines: [number, string, number, number, 1?][] = []) {
  return {
    tape: Int32Array.from([0, 1]), taped: 2, visits: 2, at: [0], keys: [KEY], notes, lines, unnoted: 0,
    rows: { ids: ['src/theme.ts', 'src/unvisited.ts'], counts: [2, 1], bases: [0, 2] },
  };
}

describe('what a story says', () => {
  it('opens a case with nothing a module holds, only what the case said', () => {
    const story = decodeStory(encodeStory(tape([[1, KEY, 'handed theme=ref3 Object']]), KEY));

    expect(story.beforeNotes).toEqual([]);
    expect(story.notes).toEqual([[1, 'handed theme=ref3 Object']]);
  });

  it('reads a story written when a module said what it held, the line as it was said', () => {
    const story = decodeStory(encodeStory(tape([[0, '', 'holds Theme=ref1 react.context'], [1, KEY, 'handed theme=ref1 Object']]), KEY));

    expect(story.beforeNotes).toEqual([[0, 'holds Theme=ref1 react.context']]);
    expect(story.notes).toEqual([[1, 'handed theme=ref1 Object']]);
  });
});

describe('where a story says the case was', () => {
  it('carries the test lines beside the notes, a hook\'s marked, never as something said', () => {
    const lines: [number, string, number, number, 1?][] = [[0, '', 2, 0], [0, KEY, 3, 0], [1, KEY, 4, 0, 1]];
    const story = decodeStory(encodeStory(tape([], lines), KEY));

    expect(story.beforeLines).toEqual([[0, 2, 0]]);
    expect(story.lines).toEqual([[0, 3, 0], [1, 4, 0, 1]]);
    expect(story.notes).toEqual([]);
  });

  it('keeps a note said before a line at the same visit before it, counting the notes of the line\'s own part', () => {
    // The hook said one thing, the case another, then the case moved to line 4 without a visit between.
    const notes: [number, string, string][] = [[0, '', 'hooked'], [1, KEY, 'first'], [1, KEY, 'second']];
    const lines: [number, string, number, number, 1?][] = [[0, '', 2, 1], [1, KEY, 3, 2], [1, KEY, 4, 3]];
    const story = decodeStory(encodeStory(tape(notes, lines), KEY));

    expect(story.notes).toEqual([[1, 'first'], [1, 'second']]);
    expect(story.lines).toEqual([[1, 3, 1], [1, 4, 2]]);
    expect(story.beforeNotes.map(([, text]) => text)).toEqual(['hooked']);
    expect(story.beforeLines).toEqual([[0, 2, 1]]);
  });

  it('reads a story written before lines were carried as one with none', () => {
    const story = decodeStory(encodeStory(tape([]), KEY));

    expect(story.lines).toEqual([]);
    expect(story.beforeLines).toEqual([]);
  });
});

describe('the case a reading is of', () => {
  it('is its file and name alone where no project ran it, and its project as well where one did', () => {
    expect(caseStem('a.test.ts', 'adds')).toBe(caseStem('a.test.ts', 'adds', undefined));
    expect(caseStem('a.test.ts', 'adds', 'chromium')).not.toBe(caseStem('a.test.ts', 'adds'));
    expect(caseStem('a.test.ts', 'adds', 'chromium')).not.toBe(caseStem('a.test.ts', 'adds', 'firefox'));
  });
});
