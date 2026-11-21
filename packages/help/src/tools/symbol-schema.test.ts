import { Ajv } from 'ajv';
import { expect, it } from 'vitest';
import { symbol } from './symbol.js';

/**
 * What `symbol` advertises is what it reads: a client that checks a call
 * against the schema before sending it sends one name as a string, or several
 * as a list.
 */

const accepts = new Ajv({ strict: false }).compile(symbol.inputSchema);

it('advertises one name said as a string', () => {
  expect(accepts({ name: 'PaymentRetry' })).toBe(true);
});

it('advertises several names said as a list', () => {
  expect(accepts({ name: ['PaymentRetry', 'RetryPolicy'] })).toBe(true);
});
