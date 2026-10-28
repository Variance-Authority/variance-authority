import { describe, expect, it } from 'vitest';
import { limitOf, notShown } from './limit.js';
import { spellingOf } from './spelling.js';

/**
 * Every listing question reads `limit` one way, and refuses one it cannot read
 * rather than answering with the default. Both the refusal and the line that
 * counts what was left out name `limit` as the surface asked takes it.
 */

const BAD = [0, -1, 2.5, 'many', ''] as const;
const WIRE = spellingOf(undefined);
const SHELL = spellingOf({ shell: 'variance ask' });

describe('limit', () => {
  it('is the default when not said, a number from the wire, or digits from the shell', () => {
    expect(limitOf({}, 12, WIRE)).toBe(12);
    expect(limitOf({ limit: 3 }, 12, WIRE)).toBe(3);
    expect(limitOf({ limit: '7' }, 12, SHELL)).toBe(7);
  });

  it('refuses anything but a whole number of at least 1', () => {
    for (const limit of BAD) expect(() => limitOf({ limit }, 12, WIRE)).toThrow(/takes a whole number of rows/);
  });

  it('names `limit` in its refusal as the surface asked takes it', () => {
    expect(() => limitOf({ limit: 0 }, 12, WIRE)).toThrow('`limit` takes a whole number of rows, at least 1; it was given `0`.');
    expect(() => limitOf({ limit: '0' }, 12, SHELL)).toThrow('`--limit` takes a whole number of rows, at least 1; it was given `0`.');
  });

  it('says the rows it left out, naming `limit` as the surface asked takes it', () => {
    expect(notShown(3, WIRE)).toBe('3 more not shown; a higher `limit` shows them.');
    expect(notShown(3, SHELL)).toBe('3 more not shown; a higher `--limit` shows them.');
  });
});
