/**
 * The ranking weights the addon defines once (`native/src/rarity.rs`), for
 * the rankings that still sum in TypeScript. Each call crosses two or four
 * numbers and returns one.
 */

// compass: variance-authority.report.agent-surface

import { entry } from './help-reading.js';

let rarityOf: ((population: number, holders: number) => number) | undefined;
let saturationOf: ((held: number, length: number, total: number, rows: number) => number) | undefined;

/** How rare a word is among `population` rows when `holders` hold it, as an integer from 0 to 1000. */
export function rarityNative(population: number, holders: number): number {
  rarityOf ??= entry('rarity');
  return rarityOf(population, holders);
}

/** BM25's saturation of a term held `held` times in a row of `length`, in thousandths, against `rows` rows of `total`. */
export function saturationNative(held: number, length: number, total: number, rows: number): number {
  saturationOf ??= entry('saturation');
  return saturationOf(held, length, total, rows);
}
