export function discount(amount: number): number {
  return amount / 10;
}

export function total(amount: number): number {
  return amount - discount(amount);
}
