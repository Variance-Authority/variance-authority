export function warm(): number {
  return 1;
}

// A call at the top level: `warm` runs when the module loads, before any test.
export const primed = warm();

export function cold(value: number): number {
  if (value > 0) {
    return value;
  }
  return -value;
}
