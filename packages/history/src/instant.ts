/**
 * One timestamp parse, shared by everything that orders rows.
 *
 * Its own file because both halves of the arithmetic depend on it — churn picks
 * the first and last change, drift sorts a journey — and a second copy of this
 * function is a second chance to compare `at` values as text. The rule it
 * enforces has to hold identically in both, so there is one of it.
 */

/**
 * An `at` as a comparable number.
 *
 * Parsed rather than compared as text because ISO-8601 only sorts lexically while
 * every timestamp shares one offset, and a store fed by CI jobs in two regions
 * does not. An unparseable timestamp throws: ordering a journey wrongly turns
 * `12px → 20px` into `20px → 12px`, which is a confident sentence that is exactly
 * backwards.
 */
export function instant(at: string): number {
  const parsed = Date.parse(at);
  if (Number.isNaN(parsed)) {
    throw new Error(`\`at\` must be an ISO-8601 instant; received "${at}"`);
  }
  return parsed;
}
