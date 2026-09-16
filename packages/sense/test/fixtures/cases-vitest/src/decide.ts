export function decide(value: string): string {
  if (value === 'alpha') {
    return 'A';
  }
  if (value === 'gamma') {
    return 'G';
  }
  return 'B';
}

export async function slowly(value: string): Promise<string> {
  await new Promise((wake) => setTimeout(wake, 5));
  if (value === 'alpha') {
    return 'slow A';
  }
  await new Promise((wake) => setTimeout(wake, 5));
  return 'slow B';
}
