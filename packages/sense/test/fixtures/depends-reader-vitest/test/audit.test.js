import { expect, it } from 'vitest';
import { feeIsLiteral } from '../src/audit';

it('audits the fee as a literal', () => {
  expect(feeIsLiteral()).toBe(true);
});
