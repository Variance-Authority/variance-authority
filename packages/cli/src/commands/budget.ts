/**
 * The run's budget for re-collecting changed subjects, granted in the order the
 * subjects were taken rather than the order they finished.
 *
 * `alone.limit` caps how much of a red build's investigation a run pays for.
 * Spent by whichever subject reaches it first, the cap would pick its subjects
 * by timing: one world reaches a file's second subject before the next file's
 * first, and several worlds do the opposite, so which changed subjects carry
 * evidence would depend on the width and differ from run to run. Granted by
 * position in the queue, it goes to the first `limit` subjects to change in
 * that order, at any width.
 *
 * A subject finds out once nothing before it can still move the answer: when
 * `limit` subjects before it have changed, or when the subjects before it that
 * are still undecided could not reach `limit` if every one of them changed.
 * Below the cap that is at once. Near it, a subject waits for the ones before it
 * to reach their verdicts, which never waits on anything after it: every lane
 * starts its subjects in queue order, so the earliest undecided subject is
 * always running its first reading or about to.
 */

/** One subject's share of the budget. */
export interface SubjectBudget {
  /** This subject changed: whether the run re-collects it. The first answer is kept, however often it is asked. */
  claim(): Promise<boolean>;
}

export interface Budget {
  /** The budget of the subject at `index` in the plan. */
  of(index: number): SubjectBudget;
  /**
   * The subject at `index` is decided. Called for every subject the queue holds,
   * whatever became of it, and a no-op after its claim.
   */
  settle(index: number): void;
}

// FIXME: `alone.limit` counts stories, not widths. A share is claimed per plan
// index, and every width a story's visit realizes rides that one share, so a
// story read at three widths can spend three clean collections on one.
export function budgetOf(limit: number, queue: readonly (readonly number[])[]): Budget {
  const position = new Map<number, number>();
  for (const index of queue.flat()) position.set(index, position.size);
  const changed = new Counts(position.size);
  const decided = new Counts(position.size);
  const isDecided = new Uint8Array(position.size);
  let waiting: (() => void)[] = [];

  function at(index: number): number {
    const found = position.get(index);
    if (found === undefined) throw new Error(`plan index ${index} is not in this run's queue, so nothing places it in the budget`);
    return found;
  }

  function decide(p: number, isChange: boolean): void {
    if (isDecided[p] === 1) return;
    isDecided[p] = 1;
    decided.add(p);
    if (isChange) changed.add(p);
    const woken = waiting;
    waiting = [];
    for (const wake of woken) wake();
  }

  /** Granted, refused, or not yet knowable. */
  function answer(p: number): boolean | undefined {
    const before = changed.before(p);
    if (before >= limit) return false;
    const undecided = p - decided.before(p);
    if (before + undecided < limit) return true;
    return undefined;
  }

  return {
    of(index) {
      return {
        async claim() {
          const p = at(index);
          decide(p, true);
          for (;;) {
            const known = answer(p);
            if (known !== undefined) return known;
            await new Promise<void>((resolve) => waiting.push(resolve));
          }
        },
      };
    },
    settle(index) {
      decide(at(index), false);
    },
  };
}

/** How many marked positions lie before a position, in logarithmic time (a Fenwick tree). */
class Counts {
  private readonly tree: Uint32Array;

  constructor(size: number) {
    this.tree = new Uint32Array(size + 1);
  }

  add(position: number): void {
    for (let i = position + 1; i < this.tree.length; i += i & -i) this.tree[i]! += 1;
  }

  before(position: number): number {
    let sum = 0;
    for (let i = position; i > 0; i -= i & -i) sum += this.tree[i]!;
    return sum;
  }
}
