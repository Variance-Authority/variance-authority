/**
 * How a review operation says no, and every value that can make it say so.
 *
 * `ReviewError` is a leaf on purpose: the store, the reader and the writer all
 * throw it, and a class everything imports cannot live in a file that imports
 * them back. The readers sit with it because they are where most of these
 * refusals come from — a stored row is validated rather than cast, for the same
 * reason [`history-rows.ts`](./history-rows.ts) does it — and `instant` is that
 * refusal applied to a timestamp on the way in rather than to a column on the way
 * out.
 */

/**
 * A review operation that cannot be carried out, as distinct from a platform
 * that could not be reached.
 *
 * Separate from `RasterStoreError` because they route differently: this is a 4xx
 * — the caller asked for something that is not so — and a store failure is a 5xx
 * and a stopped run. A single error type would make an operator's dashboard show
 * "Cloudflare is down" for a reviewer who clicked approve on the wrong subject.
 */
export class ReviewError extends Error {
  override readonly name = 'ReviewError';
}

export type Row = Record<string, unknown>;

export function text(row: Row, column: string, what: string): string {
  const value = row[column];
  if (typeof value !== 'string') {
    throw new ReviewError(`${what} has a \`${column}\` that is not text`);
  }
  return value;
}

export function optionalText(row: Row, column: string, what: string): string | undefined {
  const value = row[column];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw new ReviewError(`${what} has a \`${column}\` that is neither text nor null`);
  }
  return value;
}

export function optionalNumber(row: Row, column: string, what: string): number | undefined {
  const value = row[column];
  if (value === null || value === undefined) return undefined;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ReviewError(`${what} has a \`${column}\` that is neither a number nor null`);
  }
  return value;
}

export function number(row: Row, column: string, what: string): number {
  const value = row[column];
  if (typeof value === 'bigint') return Number(value);
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new ReviewError(`${what} has a \`${column}\` that is not a number`);
  }
  return value;
}

export function instant(at: string, what: string): number {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) {
    throw new ReviewError(`${what} carries "${at}", which is not an ISO-8601 instant`);
  }
  return parsed;
}
