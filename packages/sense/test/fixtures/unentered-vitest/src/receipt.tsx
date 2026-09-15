import { formatTotal } from './format-total.js';

export function Receipt({ cents }: { cents: number }) {
  return <p>Total: {formatTotal(cents)}</p>;
}
