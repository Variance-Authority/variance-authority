import { expect, it, vi } from 'vitest';
import { LIMIT } from '../lib/relay';

vi.mock('../lib/relay', () => ({ LIMIT: 99 }));

it('reads the limit from a mock of the relay', () => {
  expect(LIMIT).toBe(99);
});
