import { heldWeight, rarity } from '@variance-authority/mcp/tools';
import type { ReachedName, RowPick } from './described.js';

// compass: variance-authority.report.agent-surface

/** How many of `rows` hold each word. */
export function holdersOf(rows: readonly { readonly holds: readonly string[] }[]): Map<string, number> {
  const holders = new Map<string, number>();
  for (const one of rows) for (const word of one.holds) holders.set(word, (holders.get(word) ?? 0) + 1);
  return holders;
}

/**
 * Whether a row carries most of the question: the words it holds weigh at least
 * half of what `asked` weighs, each word its {@link rarity} among the repository's
 * `names`. This is Lucene's `minimum_should_match` weighed by rarity, so a row
 * sharing one common word is left out and a word nothing holds weighs the most.
 * `reached` holds every row of the repository holding an asked word, in an area
 * too, and counts each word's holders.
 */
export function carriesMost(
  asked: readonly string[],
  reached: readonly { readonly holds: readonly string[] }[],
  names: number,
): (row: { readonly words: readonly string[] }) => boolean {
  const holders = holdersOf(reached);
  // Counted over the reached rows alone, a word most of them hold would weigh
  // little however rare it is in the repository.
  const population = Math.max(names, reached.length);
  const rareOf = (word: string): number => rarity(population, holders.get(word) ?? 0);
  const whole = heldWeight(asked, rareOf, () => 1);
  return ({ words }) => 2 * heldWeight(words, rareOf, () => 1) >= whole;
}

/**
 * The row of `picks`, best first, a name is shown through, and the rows level
 * with it. A row with no doc writes no phrase, so it never comes before the row chosen.
 */
export function representedBy(picks: readonly RowPick[]): RowPick & { readonly tied: readonly RowPick[] } {
  const chosen = picks[0] as RowPick;
  return { ...chosen, tied: picks.filter((one) => one === chosen || (one.docLength !== undefined && one.weighs === chosen.weighs)) };
}

/** `one` shown through the best of its rows that `carries` admits; `undefined` when none does. */
export function carriedThrough(one: ReachedName, carries: (row: { readonly words: readonly string[] }) => boolean): ReachedName | undefined {
  const picks = one.picks.filter(carries);
  return picks.length === 0 ? undefined : { ...one, ...representedBy(picks) };
}
