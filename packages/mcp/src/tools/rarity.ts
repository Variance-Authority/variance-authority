// compass: variance-authority.report.agent-surface

import { rarityNative, saturationNative } from '@variance-authority/sense/rarity';

/**
 * How rare a word is in a population, as an integer from 0 to 1000: of
 * `population` rows, `holders` hold the word. A word every row holds scores
 * 1000 / (population + 1), never zero; a word one row holds scores nearly 1000.
 * Defined once, in the addon, which ranks with it too.
 *
 * An integer, so a sort key built from it is exact and a tie is a tie
 * (ADR-0057: no float reaches a sort key). A ranking multiplies it by the
 * integer weight of the field the word was found in and sums over the words,
 * as {@link heldWeight} does.
 * The population is whatever the ranking counts over, and both halves are
 * counted over the same rows: a scope that drops rows recounts the holders too.
 */
export function rarity(population: number, holders: number): number {
  return rarityNative(population, holders);
}

/**
 * The weight a row holds of a question: for each thing it holds, the
 * {@link rarity} of the word times the integer weight of the field it is held
 * in, summed. An integer, as each term is.
 */
export function heldWeight<Held>(held: readonly Held[], rarityOf: (one: Held) => number, fieldOf: (one: Held) => number): number {
  return held.reduce((sum, one) => sum + rarityOf(one) * fieldOf(one), 0);
}

/**
 * BM25's saturation of a term held `held` times in a row of `length`, in
 * thousandths, against the mean of `rows` rows of `total` in all. With `k1`
 * six fifths and `b` three quarters,
 * `1000 h (k1 + 1) / (h + k1 (1 - b) + k1 b L / A)` is
 * `22000 h A / (10 h A + 3 A + 9 L)`, here with `A` as `total / rows`
 * multiplied through: a term held once in a row of the mean length counts
 * 1000, in an empty one 1692, in one ten times the mean 213. With no length to
 * measure against, every row is of the mean length.
 */
export function saturation(held: number, length: number, total: number, rows: number): number {
  return saturationNative(held, length, total, rows);
}
