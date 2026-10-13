/**
 * Whether an accepting run rewrites a baseline the run found unchanged.
 *
 * Nothing changed, so there is nothing to accept, but the baseline is left
 * worse than a fresh one in two ways: painted under another identity, it names
 * the same move on every later run (ADR-0090); keeping no snapshot of its
 * nodes, it joins the first change after it against one render (ADR-0027).
 *
 * One rule, asked of the signals an observation and its record share, so that
 * Playwright's `--update-snapshots`, vitest's `--update` and `variance accept`
 * cannot come to disagree about which unchanged baselines they rewrite.
 */
export function restamps(
  signals: { readonly identity?: unknown; readonly snapshot?: 'unrecorded' } | undefined,
): boolean {
  return signals?.identity !== undefined || signals?.snapshot === 'unrecorded';
}
