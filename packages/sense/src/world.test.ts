import { describe, expect, it } from 'vitest';
import { worldIn } from './world.js';

describe('the scanned tree membership', () => {
  it('answers for exact listed paths and leaves every other path absent', () => {
    const world = worldIn(['a/b.java', 'a/b/c.java', 'ab/e.java']);
    expect(world.has('a/b.java')).toBe(true);
    expect(world.has('a/b/c.java')).toBe(true);
    expect(world.has('a')).toBe(false);
    expect(world.has('a/b')).toBe(false);
    expect(world.has('a/b/other.java')).toBe(false);
  });

  it('keeps membership independent of duplicate paths or iteration order', () => {
    const world = worldIn(['z.ts', 'a.ts', 'z.ts']);
    expect(world.has('a.ts')).toBe(true);
    expect(world.has('z.ts')).toBe(true);
    expect(world.has('A.ts')).toBe(false);
  });
});
