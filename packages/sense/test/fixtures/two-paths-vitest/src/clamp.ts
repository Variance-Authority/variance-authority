import { MAX as M } from './most';

export const MAX = 10;

export function clamp(n: number): number {
  return Math.min(n, M);
}

export function lowest(n: number): number {
  return Math.max(n, 0);
}
