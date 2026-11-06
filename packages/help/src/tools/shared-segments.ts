// compass: variance-authority.report.agent-surface

import { codeUnitOrder } from '@variance-authority/core/segment';

/**
 * How many leading path segments two files share: how near one is to the
 * other, which orders `uses` sites and `symbol` declarations nearest a file
 * the caller named first.
 */
export function sharedSegments(left: string, right: string): number {
  const a = left.split('/');
  const b = right.split('/');

  let shared = 0;
  while (shared < a.length && shared < b.length && a[shared] === b[shared]) shared += 1;
  return shared;
}

/**
 * Places in order of nearness to `from`: the most shared leading segments
 * first, then by file in code units, then by line. No `from` orders by file
 * and line alone.
 */
export function nearestTo(from: string | undefined): (left: { readonly at: string; readonly line: number }, right: { readonly at: string; readonly line: number }) => number {
  return (left, right) =>
    (from === undefined ? 0 : sharedSegments(from, right.at) - sharedSegments(from, left.at)) ||
    codeUnitOrder(left.at, right.at) ||
    left.line - right.line;
}
