import { afterEach, describe, expect, it } from 'vitest';
import { eyesJournal, type Attention } from './access.js';
import { handToRunningCase, watchRunningCase } from './case.js';

const CASE_SCOPE = Symbol.for('variance-authority.test-selection.cases');
type Holder = { [CASE_SCOPE]?: unknown };

const found = (globalThis as Holder)[CASE_SCOPE];
afterEach(() => {
  (globalThis as Holder)[CASE_SCOPE] = found;
});

function recordingAt(root: string): Readonly<Record<string, unknown>>[] {
  const handed: Readonly<Record<string, unknown>>[] = [];
  (globalThis as Holder)[CASE_SCOPE] = { root, eyes: (journal: Readonly<Record<string, unknown>>) => handed.push(journal) > 0 };
  return handed;
}

const ATTENTION = [
  {
    sequence: 0,
    kind: 'document-event',
    event: 'click',
    trusted: true,
    target: {
      nodeName: 'BUTTON',
      provenance: {
        status: 'resolved',
        provenance: { owners: [], source: { file: '/work/app/src/Button.tsx', line: 4, column: 10 } },
      },
    },
  },
  {
    sequence: 1,
    kind: 'react-commit',
    commit: {
      at: 1,
      components: ['App'],
      updaters: [
        { path: [], source: { file: '/work/app/src/App.tsx', line: 9, column: 3 } },
        { path: [], source: { file: '/elsewhere/vendor.js', line: 1, column: 1 } },
      ],
    },
  },
  { sequence: 2, kind: 'rtl-query', query: 'getByText', arguments: [{ kind: 'regexp', source: 'Add', flags: 'i' }], outcome: 'absent' },
] as unknown as readonly Attention[];

describe('a journal opened for the running case', () => {
  it('tells the case it is watched, so a test that never hands one over is told apart from one that opened none', () => {
    let watched = 0;
    (globalThis as Holder)[CASE_SCOPE] = { root: '/work/app', eyes: () => true, watch: () => void watched++ };
    expect(watchRunningCase()).toBe(true);
    expect(watched).toBe(1);
  });

  it('is no one\'s when no recording run is in scope, or its scope takes no word of one', () => {
    (globalThis as Holder)[CASE_SCOPE] = undefined;
    expect(watchRunningCase()).toBe(false);
    (globalThis as Holder)[CASE_SCOPE] = { root: '/work/app', eyes: () => true };
    expect(watchRunningCase()).toBe(false);
  });
});

describe('a journal handed to the running case', () => {
  it('names the files it saw against the checkout the record names them against', () => {
    const handed = recordingAt('/work/app');
    expect(handToRunningCase(eyesJournal(ATTENTION))).toBe(true);
    expect(handed).toHaveLength(1);
    const journal = handed[0] as { complete: boolean; attention: readonly Record<string, unknown>[] };
    expect(journal.complete).toBe(true);
    expect(JSON.stringify(journal)).not.toContain('/work/app/');
    expect(journal.attention[0]).toMatchObject({
      target: { provenance: { provenance: { source: { file: 'src/Button.tsx', line: 4, column: 10 } } } },
    });
    expect(journal.attention[1]).toMatchObject({
      commit: {
        updaters: [
          { source: { file: 'src/App.tsx' } },
          // Outside the checkout there is nothing to be relative to, and the path stays whole.
          { source: { file: '/elsewhere/vendor.js' } },
        ],
      },
    });
    // A regular expression's `source` is its pattern, not a place.
    expect(journal.attention[2]).toMatchObject({ arguments: [{ kind: 'regexp', source: 'Add' }] });
    // The record names the case and the attempt; the journal carries neither.
    expect(Object.keys(journal).sort()).toEqual(['attention', 'complete']);
  });

  it('says it went nowhere when no recording run is in scope', () => {
    delete (globalThis as Holder)[CASE_SCOPE];
    expect(handToRunningCase(eyesJournal(ATTENTION))).toBe(false);
  });

  it('says why a journal with a gap in its sequence is incomplete', () => {
    const handed = recordingAt('/work/app');
    handToRunningCase(eyesJournal([ATTENTION[0]!, ATTENTION[2]!]));
    expect(handed[0]).toMatchObject({ complete: false });
    expect(typeof handed[0]!['because']).toBe('string');
  });
});
