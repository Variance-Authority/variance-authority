import { CrossingSets, type CrossingSetsPool, type SetId } from './crossing-sets.js';
import type { CrossingSetsView } from './crossing-sets-read.js';

/** The first set a pool interns is the empty one, and every translation starts it that way. */
export const EMPTY = 0;

/**
 * One output pool, and the translation of each input pool into it.
 *
 * Each input set is read once and interned once, however many regions name it;
 * a union is interned once per distinct pair. That keeps the layering at the
 * size of the sets rather than of the crossings they stand for.
 */
export class Translation {
  readonly #sets: CrossingSets;
  readonly #members: Uint32Array[] = [];
  readonly #unions = new Map<string, SetId>();

  constructor(testCount: number) {
    this.#sets = new CrossingSets(testCount);
    this.#intern(new Uint32Array());
  }

  /** Translate `view`'s sets through `remap`, which names -1 for a case that is gone. */
  from(view: CrossingSetsView, remap: ArrayLike<number>): (set: SetId) => SetId {
    const memo = new Map<SetId, SetId>();
    return (set) => {
      let found = memo.get(set);
      if (found === undefined) {
        const members: number[] = [];
        for (const test of view.members(set)) {
          const to = remap[test];
          if (to === undefined) throw new Error('a case index names a case it does not hold');
          if (to >= 0) members.push(to);
        }
        found = this.#intern(Uint32Array.from(members).sort());
        memo.set(set, found);
      }
      return found;
    };
  }

  union(left: SetId, right: SetId): SetId {
    if (left === right || right === EMPTY) return left;
    if (left === EMPTY) return right;
    const key = left < right ? `${left},${right}` : `${right},${left}`;
    let found = this.#unions.get(key);
    if (found === undefined) {
      found = this.#intern(Uint32Array.from(new Set([...this.#members[left]!, ...this.#members[right]!])).sort());
      this.#unions.set(key, found);
    }
    return found;
  }

  pool(): CrossingSetsPool {
    return this.#sets.pool();
  }

  #intern(members: Uint32Array): SetId {
    const id = this.#sets.intern(members);
    this.#members[id] ??= members;
    return id;
  }
}
