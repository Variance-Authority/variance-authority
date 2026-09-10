export type Outcome = 'A' | 'B' | 'G';

export function decide(value: string): Outcome {
  if (value === 'alpha') {
    return 'A';
  }
  if (value === 'gamma') {
    return 'G';
  }
  return 'B';
}
