export function basket(currency) {
  if (currency === 'eur') {
    return 'basket in euros';
  }
  if (currency === 'gbp') {
    return 'basket in pounds';
  }
  return 'basket in dollars';
}

export function returned(amount) {
  if (amount > 100) {
    return 'return held';
  }
  return 'return accepted';
}
