/**
 * How rare a word is in a population, as an integer from 0 to 1000: of
 * `population` rows, `holders` hold the word. A word every row holds scores
 * 1000 / (population + 1), never zero; a word one row holds scores nearly 1000.
 *
 * An integer, so a sort key built from it is exact and a tie is a tie
 * (ADR-0057: no float reaches a sort key). A ranking multiplies it by the
 * integer weight of the field the word was found in and sums over the words.
 * The population is whatever the ranking counts over, and both halves are
 * counted over the same rows: a scope that drops rows recounts the holders too.
 */
export function rarity(population: number, holders: number): number {
  return Math.floor((1000 * (population - holders + 1)) / (population + 1));
}
