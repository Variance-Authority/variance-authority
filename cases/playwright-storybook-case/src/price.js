export function price(amount) {
  if (amount > 10) {
    return amount * 2;
  }
  return amount;
}

export function discount(amount) {
  if (amount > 100) {
    return amount - 10;
  }
  return amount;
}
