import { useState } from 'react';
import { discount, price } from './price.js';

export function Price({ amount }) {
  return <span data-testid="price">{price(amount)}</span>;
}

export function Checkout({ amount }) {
  const [paid, setPaid] = useState(false);
  if (paid) {
    return <p data-testid="receipt">Paid {discount(amount)}</p>;
  }
  return (
    <button type="button" onClick={() => setPaid(true)}>
      Pay {amount}
    </button>
  );
}
