// compass: variance-authority.report.agent-surface

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
