import * as self from './cap';

export const LIMIT = 10;

export function cap(n: number): number {
  return Math.min(n, self.LIMIT);
}

export function floor(n: number): number {
  return Math.max(n, 0);
}
