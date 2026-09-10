import { expect, it, vi } from 'vitest';

it('keeps what it entered before the module registry was reset', async () => {
  const { decide } = await import('../src/decide.js');
  expect(decide('gamma')).toBe('G');
  vi.resetModules();
  const again = await import('../src/decide.js');
  expect(again.decide('beta')).toBe('B');
});
