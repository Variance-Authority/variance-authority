export const RATE = 3;

export function charge(amount: number): number {
  return amount * RATE;
}
