export function decide(value: string): string {
  if (value === 'alpha') {
    return 'A';
  }
  if (value === 'gamma') {
    return 'G';
  }
  return 'B';
}
