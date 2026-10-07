/**
 * Counts and short lists in the sentences the commands print.
 *
 * One place, because the selector, the reach report and the beyond-reach
 * notes print halves of the same sentences, and two that pluralise
 * differently read as two tools that happened to agree.
 */

/** `1 component`, `3 components` — never `3 component(s)`, which is storage. */
export function many(count: number, singular: string): string {
  return `${count} ${singular}${count === 1 ? '' : 's'}`;
}

/** Up to three names in prose, and a count for the rest. */
export function listed(names: readonly string[]): string {
  if (names.length <= 3) {
    const head = names.slice(0, -1).join(', ');
    return head === '' ? names[0]! : `${head} and ${names[names.length - 1]!}`;
  }
  return `${names.slice(0, 3).join(', ')} and ${names.length - 3} more`;
}
