/** Adds the numbers it is given. */
export function tally(...numbers: number[]): number {
  return numbers.reduce((sum, n) => sum + n, 0);
}
