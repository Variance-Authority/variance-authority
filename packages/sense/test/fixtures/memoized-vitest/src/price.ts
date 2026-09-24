import { memoizeOne } from '../lib/memoize-one.js';
import { locale } from './locale.js';

export const formatPrice = memoizeOne((cents) => {
  const whole = Math.floor(cents / 100);
  return `${locale.symbol()}${whole}.${String(cents % 100).padStart(2, '0')}`;
});
