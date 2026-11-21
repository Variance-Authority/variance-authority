/**
 * The ranking weights the addon defines once (`native/src/rarity.rs`), for
 * the rankings that still sum in TypeScript. Each call crosses two or four
 * numbers and returns one.
 *
 * Reached through `@variance-authority/sense/rarity`, which loads the addon
 * and nothing else: the MCP root entry ranks with these and must stay small.
 */

// compass: variance-authority.report.agent-surface

import { native, nativeRefusal } from './addon.js';

/** The two weights as the addon exports them. */
interface NativeRarity {
  rarity?(population: number, holders: number): number;
  saturation?(held: number, length: number, total: number, rows: number): number;
}

function weights(): Required<NativeRarity> {
  const addon = native() as NativeRarity | undefined;
  if (addon?.rarity === undefined || addon.saturation === undefined) {
    throw new Error(`the ranking weights are defined by the native scanner, and ${nativeRefusal() ?? 'the scanner that loaded has no `rarity`; build it again'}`);
  }
  return addon as Required<NativeRarity>;
}

let loaded: Required<NativeRarity> | undefined;

/** How rare a word is among `population` rows when `holders` hold it, as an integer from 0 to 1000. */
export function rarityNative(population: number, holders: number): number {
  loaded ??= weights();
  return loaded.rarity(population, holders);
}

/** BM25's saturation of a term held `held` times in a row of `length`, in thousandths, against `rows` rows of `total`. */
export function saturationNative(held: number, length: number, total: number, rows: number): number {
  loaded ??= weights();
  return loaded.saturation(held, length, total, rows);
}
