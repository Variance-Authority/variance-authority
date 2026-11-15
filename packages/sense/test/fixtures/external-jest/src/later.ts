/** A module only a test body requires: Jest transforms it at that require, unless the run warmed its cache first. */
export function later(value: string): string {
  return value.toUpperCase();
}
