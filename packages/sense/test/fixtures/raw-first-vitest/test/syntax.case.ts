import { expect, it } from 'vitest';
import { Direction, Geometry, Square, calls, config, shape, size } from '../src/syntax.ts';

it('runs every piece of TypeScript-only syntax as the compiler meant it', () => {
  expect(Direction.Down).toBe(2);
  expect(Direction[2]).toBe('Down');
  expect(Geometry.double(4)).toBe(8);

  const square = new Square(3);
  expect(square.unit).toBe('cm');
  expect(square.describe()).toBe('area 9');
  expect(calls).toEqual(['area']);
  expect(Object.isSealed(Square)).toBe(true);

  expect(size('abc')).toBe(3);
  expect(size([1, 2])).toBe(2);
  expect(config.direction).toBe(Direction.Down);
  expect(shape.side).toBe(3);
});
