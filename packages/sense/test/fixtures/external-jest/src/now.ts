/** A module a test file requires at its top, before its first case: Jest transforms it at that load. */
export function now(value: string): string {
  return `${value}!`;
}
