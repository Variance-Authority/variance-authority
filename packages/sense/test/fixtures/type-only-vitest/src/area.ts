import type { Square } from './shapes.ts';

export * from './shapes.ts';

export function area(square: Square): number {
  return square.side * square.side;
}
