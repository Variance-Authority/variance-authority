import { describe, expect, it } from 'vitest';
import { settleRecipe, type Intervention } from './stabilize.js';
import { stepClock, totalsOf } from './steps.js';

/** A clock that moves by the given amounts, one per reading. */
function ticking(...deltas: number[]): () => number {
  let now = 0;
  let k = 0;
  return () => (now += deltas[k++] ?? 0);
}

describe('stepClock', () => {
  it('takes each step in the order it ran, under its own name', async () => {
    const clock = stepClock(ticking(0, 3, 0, 7));
    await clock.time('navigate', async () => undefined);
    await clock.time('read', () => 1);

    expect(clock.taken).toEqual([
      { step: 'navigate', ms: 3 },
      { step: 'read', ms: 7 },
    ]);
  });

  it('takes a step that threw, so a failure is still placed', async () => {
    const clock = stepClock(ticking(0, 4));
    await expect(
      clock.time('navigate', async () => {
        throw new Error('timeout');
      }),
    ).rejects.toThrow('timeout');

    expect(clock.taken).toEqual([{ step: 'navigate', ms: 4 }]);
  });

  it('qualifies what another owner reports, in place, without timing it again', async () => {
    const clock = stepClock(ticking(0, 2, 0, 5));
    await clock.time('inspect', async () => undefined);
    clock.add([{ step: 'navigate', ms: 30 }], 'collect.');
    await clock.within('render.').time('screenshot', async () => undefined);

    expect(clock.taken.map((s) => s.step)).toEqual(['inspect', 'collect.navigate', 'render.screenshot']);
    expect(clock.taken.map((s) => s.ms)).toEqual([2, 30, 5]);
  });
});

describe('totalsOf', () => {
  it('sums each step over the subjects that ran it, and counts them, never averaging in an absence', () => {
    const totals = totalsOf([
      [
        { step: 'navigate', ms: 10 },
        { step: 'screenshot', ms: 4 },
      ],
      [{ step: 'navigate', ms: 20 }],
      undefined,
    ]);

    expect(totals).toEqual([
      { step: 'navigate', ms: 30, subjects: 2 },
      { step: 'screenshot', ms: 4, subjects: 1 },
    ]);
  });

  it('counts a subject once for a step it ran twice', () => {
    expect(
      totalsOf([
        [
          { step: 'network', ms: 1 },
          { step: 'network', ms: 2 },
        ],
      ]),
    ).toEqual([{ step: 'network', ms: 3, subjects: 1 }]);
  });
});

describe('settleRecipe', () => {
  it('takes each intervention that waits as a step named by its id, and nothing for one that does not', async () => {
    const waits: Intervention = { ...stub('wait-for-fonts'), settle: async () => undefined };
    const css: Intervention = stub('no-caret');
    const clock = stepClock(ticking(0, 6));

    await settleRecipe([css, waits], { evaluate: async () => undefined } as never, clock);

    expect(clock.taken).toEqual([{ step: 'wait-for-fonts', ms: 6 }]);
  });
});

function stub(id: string): Intervention {
  return { id, trick: 'css', needs: 'layout', governs: 'fonts', because: id } as unknown as Intervention;
}
