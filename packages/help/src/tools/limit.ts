/**
 * `limit`, as every listing question reads it: how many rows to show, where
 * every row is still counted and the rest are said.
 */

// compass: variance-authority.report.agent-surface

/** The `limit` said in `input`, a whole number above zero, or `shown` when none is. */
export function limitOf(input: Readonly<Record<string, unknown>>, shown: number): number {
  const said = input['limit'];
  return typeof said === 'number' && Number.isInteger(said) && said > 0 ? said : shown;
}

/** What a listing says of the rows it left out. */
export function notShown(rest: number): string {
  return `${rest} more not shown; a higher \`limit\` shows them.`;
}
