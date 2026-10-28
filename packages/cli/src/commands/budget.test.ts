import { describe, expect, it } from 'vitest';
import { budgetOf } from './budget.js';

/**
 * The re-collection budget on its own: granted by position in the queue, so
 * the subjects it reaches do not depend on which world finished first.
 */

describe('budgetOf', () => {
  it('grants the first subjects to change in queue order, whatever order they claim in', async () => {
    // Plan indices 4, 2 | 0, 3: queue order, not plan order, is what counts.
    const budget = budgetOf(2, [[4, 2], [0, 3]]);

    const late = budget.of(3).claim();
    const first = budget.of(4).claim();
    budget.settle(2);
    const third = budget.of(0).claim();

    expect(await Promise.all([first, third, late])).toEqual([true, true, false]);
  });

  it('answers at once while nothing before a subject could reach the limit', async () => {
    const budget = budgetOf(3, [[0, 1, 2]]);
    // Two undecided before it and none changed: two more changes could not spend three.
    expect(await budget.of(2).claim()).toBe(true);
  });

  it('waits only for a subject before it that could still spend the last share', async () => {
    const budget = budgetOf(1, [[0], [1]]);
    let answered: boolean | undefined;
    const claim = budget.of(1).claim().then((granted) => (answered = granted));

    await Promise.resolve();
    expect(answered).toBeUndefined();
    budget.settle(0);
    await claim;
    expect(answered).toBe(true);
  });

  it('refuses everything at a limit of zero, and settles a claimed subject as changed', async () => {
    const budget = budgetOf(0, [[0, 1]]);
    expect(await budget.of(0).claim()).toBe(false);
    budget.settle(0);
    expect(await budget.of(1).claim()).toBe(false);
  });

  it('refuses a subject the queue does not hold, rather than placing it anywhere', () => {
    expect(() => budgetOf(1, [[0]]).settle(5)).toThrow(/plan index 5 is not in this run's queue/);
  });
});
