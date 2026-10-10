/**
 * A part of an answer listed a row per value, at most `limit` rows, and the
 * rest counted on one more line. The count is the only trace of what was left
 * out, so a reader knows the list is not the whole part.
 */
export function cappedRows<T>(rows: readonly T[], row: (value: T) => string, limit: number): string[] {
  const shown = rows.slice(0, limit).map(row);
  return rows.length > limit ? [...shown, `  and ${rows.length - limit} more`] : shown;
}
