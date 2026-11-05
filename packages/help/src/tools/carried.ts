import { heldWeight, rarity } from '@variance-authority/mcp/tools';

// compass: variance-authority.report.agent-surface

/**
 * Whether a row carries most of the question: the words it holds weigh at least
 * half of what `asked` weighs, each word its {@link rarity} among the repository's
 * `names`. This is Lucene's `minimum_should_match` weighed by rarity, so a row
 * sharing one common word is left out and a word nothing holds weighs the most.
 * `reached` holds every row holding an asked word, and counts each word's holders.
 */
export function carriesMost(
  asked: readonly string[],
  reached: readonly { readonly holds: readonly string[] }[],
  names: number,
): (row: { readonly words: readonly string[] }) => boolean {
  const holders = new Map<string, number>();
  for (const one of reached) for (const word of one.holds) holders.set(word, (holders.get(word) ?? 0) + 1);
  // Counted over the reached rows alone, a word two of two rows hold would weigh
  // nothing. In an area this can only keep a row, never cut one.
  const population = Math.max(names, reached.length);
  const rareOf = (word: string): number => rarity(population, holders.get(word) ?? 0);
  const whole = heldWeight(asked, rareOf, () => 1);
  return ({ words }) => 2 * heldWeight(words, rareOf, () => 1) >= whole;
}
