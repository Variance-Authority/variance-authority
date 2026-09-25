export type Weight = 'light' | 'heavy';

export function weigh(value: string): Weight {
  if (value.length > 4) {
    return 'heavy';
  }
  return 'light';
}
