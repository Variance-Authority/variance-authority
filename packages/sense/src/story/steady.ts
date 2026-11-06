/**
 * The step every comparison of readings shares: what holds on every reading of
 * some sides and on none of the rest, apart from what moves within a side.
 * Stories compare by it (`compare.ts`), and so do the readings the record keeps
 * (`outcomes.ts`).
 */

/**
 * What every reading of some sides has and no reading of the rest, by the
 * positions of the sides that hold it joined by commas; and the things some
 * side has on some of its readings only. What every side holds is no difference.
 * A group's keys come in the order the newest reading of its first side
 * reached them: no side before that one holds them, and that reading holds
 * every one, so it is where each is first met.
 */
export function steady<R>(sides: readonly (readonly R[])[], of: (read: R) => ReadonlySet<string>): { held: Map<string, string[]>; unsteady: string[] } {
  const held = new Map<string, string[]>();
  const unsteady: string[] = [];
  for (const key of new Set(sides.flatMap((reads) => reads.flatMap((read) => [...of(read)])))) {
    const counts = sides.map((reads) => reads.filter((read) => of(read).has(key)).length);
    if (counts.some((count, at) => count > 0 && count < sides[at]!.length)) {
      unsteady.push(key);
      continue;
    }
    const holders = counts.flatMap((count, at) => (count > 0 ? [at] : []));
    if (holders.length === sides.length) continue;
    const group = holders.join(',');
    held.set(group, [...held.get(group) ?? [], key]);
  }
  return { held, unsteady };
}
