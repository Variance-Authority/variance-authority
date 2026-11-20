import { describe, expect, it } from 'vitest';
import { limitOf, nextPage, notShown, notShownPast, pageAt, pageOf, paged } from './limit.js';
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

  it('names the rows it left out, one or many, where an answer holds more than one list', () => {
    const rows = { one: 'declaration of `rank`', many: 'declarations of `rank`' };
    expect(notShown(1, SHELL, rows)).toBe('1 more declaration of `rank` not shown; a higher `--limit` shows them.');
    expect(notShownPast(7, 5, SHELL, rows)).toEqual(['2 more declarations of `rank` not shown; a higher `--limit` shows them.']);
    expect(notShownPast(5, 5, SHELL, rows)).toEqual([]);
  });

  it('reads `offset` as `limit` is read, 0 when not said, and refuses anything but a whole number of rows to skip', () => {
    expect(pageOf({}, 12, WIRE)).toEqual({ offset: 0, limit: 12 });
    expect(pageOf({ offset: 24, limit: 6 }, 12, WIRE)).toEqual({ offset: 24, limit: 6 });
    expect(pageOf({ offset: '50' }, 12, SHELL)).toEqual({ offset: 50, limit: 12 });
    for (const offset of [-1, 2.5, 'next', '']) expect(() => pageOf({ offset }, 12, WIRE)).toThrow(/takes a whole number of rows to skip/);
    expect(() => pageOf({ offset: '-1' }, 12, SHELL)).toThrow('`--offset` takes a whole number of rows to skip, 0 or more; it was given `-1`.');
  });

  it('shows the rows of the page, and ends a page short of the last row with the offset of the next', () => {
    const rows = Array.from({ length: 7 }, (_, at) => at);
    expect(paged(rows, { offset: 3, limit: 2 })).toEqual([3, 4]);
    expect(nextPage({ offset: 0, limit: 5 }, 7, SHELL)).toEqual(['2 more not shown; `--offset` 5 shows the next 2.']);
    expect(nextPage({ offset: 0, limit: 2 }, 7, WIRE)).toEqual(['5 more not shown; `offset` 2 shows the next 2.']);
    expect(nextPage({ offset: 5, limit: 5 }, 7, SHELL)).toEqual([]);
  });

  it('says which rows a page shows when it does not start at the first, and that one past the last row shows none', () => {
    expect(pageAt({ offset: 0, limit: 5 }, 7, SHELL)).toEqual([]);
    expect(pageAt({ offset: 5, limit: 5 }, 7, SHELL)).toEqual(['Rows 6–7 of 7.']);
    expect(pageAt({ offset: 7, limit: 5 }, 7, SHELL)).toEqual(['`--offset` 7 is past the last of 7 rows.']);
    expect(pageAt({ offset: 9, limit: 5 }, 7, WIRE)).toEqual(['`offset` 9 is past the last of 7 rows.']);
  });
});
