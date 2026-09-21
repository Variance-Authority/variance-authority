export type Outcome = 'A' | 'B' | 'D' | 'G';

export function decide(value: string): Outcome {
  if (value === 'alpha') {
    return 'A';
  }
  if (value === 'gamma') {
    return 'G';
  }
  if (value === 'delta') {
    return 'D';
  }
  return 'B';
}
