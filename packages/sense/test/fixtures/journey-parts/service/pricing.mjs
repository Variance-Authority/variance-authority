export function quote(currency) {
  if (currency === 'eur') {
    return '9,00 €';
  }
  if (currency === 'gbp') {
    return '£7.80';
  }
  return '$9.99';
}

export function refund(amount) {
  if (amount > 100) {
    return 'review';
  }
  return 'refunded';
}
