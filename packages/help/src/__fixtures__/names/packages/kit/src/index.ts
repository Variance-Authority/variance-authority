/** Freezes a value and everything it holds. */
export function freeze<T>(value: T): T {
  return Object.freeze(value);
}

export const plain = (n: number): number => n + 1;

export type { Clock } from './clock.js';
export { tally as count } from './tally.js';
export { default as Shape } from './shape.js';
export * as units from './units.js';
