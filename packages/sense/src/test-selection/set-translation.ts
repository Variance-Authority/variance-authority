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
  /**
   * A landing whose final case numbering is not known yet stages its sets
   * here. Input sets translate once and distinct union pairs remain shared;
   * only final region expressions enter the stored CrossingSets pool.
   */
  static deferred(live: (generation: number) => boolean): PendingTranslation { return new PendingTranslation(live); }

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

  /** The cases an output set holds, ascending. */
  members(set: SetId): Uint32Array {
    const found = this.#members[set];
    if (found === undefined) throw new Error('a case index names a set it does not hold');
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

/** Deferred unions keep intermediate shard prefixes out of the stored set pool. */
class PendingTranslation {
  readonly #nodes: (Uint32Array | readonly [SetId, SetId])[] = [new Uint32Array()];
  readonly #unions = new Map<string, SetId>();
  constructor(readonly live: (generation: number) => boolean) {}
  get size(): number { return this.#nodes.length; }
  from(view: CrossingSetsView, places: readonly number[]): (set: SetId) => SetId {
    const translated = new Map<SetId, SetId>();
    return (set) => {
      let found = translated.get(set);
      if (found === undefined) {
        const rows: number[] = [];
        for (const row of view.members(set)) { const to = places[row]; if (to === undefined) throw new Error('a case index names a case it does not hold'); if (to >= 0) rows.push(to); }
        const members = Uint32Array.from(rows);
        found = members.length === 0 ? 0 : this.#nodes.push(members) - 1;
        translated.set(set, found);
      }
      return found;
    };
  }
  union(left: SetId, right: SetId): SetId {
    if (left === 0 || left === right) return right;
    if (right === 0) return left;
    const key = left < right ? `${left},${right}` : `${right},${left}`;
    let found = this.#unions.get(key);
    if (found === undefined) { found = this.#nodes.push([left, right]) - 1; this.#unions.set(key, found); }
    return found;
  }
  #marks = new Uint32Array(1024);
  #nodesSeen = new Uint32Array(1024);
  #scratch = new Uint32Array(1024);
  #stamp = 0;
  #length = 0;

  has(set: SetId): boolean {
    return this.#walk(set, undefined, true);
  }

  /** The caller interns these scratch members before asking for another set. */
  mapped(set: SetId, places: Int32Array): Uint32Array {
    this.#walk(set, places, false);
    return this.#scratch.subarray(0, this.#length);
  }

  members(set: SetId): Uint32Array {
    this.#walk(set, undefined, false);
    return this.#scratch.slice(0, this.#length).sort();
  }

  #walk(set: SetId, places: Int32Array | undefined, stop: boolean): boolean {
    this.#stamp += 1;
    if (this.#stamp === 0xffffffff) { this.#stamp = 1; this.#marks.fill(0); this.#nodesSeen.fill(0); }
    this.#length = 0;
    const pending = [set];
    while (pending.length !== 0) {
      const at = pending.pop()!;
      if (at >= this.#nodesSeen.length) { let size = this.#nodesSeen.length; while (size <= at) size *= 2; const grown = new Uint32Array(size); grown.set(this.#nodesSeen); this.#nodesSeen = grown; }
      if (this.#nodesSeen[at] === this.#stamp) continue;
      this.#nodesSeen[at] = this.#stamp;
      const node = this.#nodes[at]!;
      if (!(node instanceof Uint32Array)) { pending.push(...node); continue; }
      for (const row of node) {
        if (!this.live(row)) continue;
        if (stop) return true;
        if (row >= this.#marks.length) { let size = this.#marks.length; while (size <= row) size *= 2; const grown = new Uint32Array(size); grown.set(this.#marks); this.#marks = grown; }
        if (this.#marks[row] === this.#stamp) continue;
        this.#marks[row] = this.#stamp;
        const mapped = places === undefined ? row : places[row]!;
        if (mapped === undefined) throw new Error('a case index names a case it does not hold');
        if (mapped < 0) continue;
        if (this.#length === this.#scratch.length) { const grown = new Uint32Array(this.#scratch.length * 2); grown.set(this.#scratch); this.#scratch = grown; }
        this.#scratch[this.#length++] = mapped;
      }
    }
    return false;
  }

}


