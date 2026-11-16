import { expect, it, vi } from 'vitest';

const { update, scan } = vi.hoisted(() => ({
  update: vi.fn().mockResolvedValue(undefined),
  scan: vi.fn().mockRejectedValue(new Error('JavaScript indexing ran')),
}));
vi.mock('./native-update.js', () => ({ updateNatively: update }));
vi.mock('./scan.js', async (original) => ({
  ...await original<typeof import('./scan.js')>(),
  scanCount: scan,
}));

import { updateSourceIndex } from './published.js';

it('surfaces a native indexing refusal without constructing an index in JavaScript', async () => {
  await expect(updateSourceIndex('/native-only-fixture', { index: '/native-only-fixture/index.bin' }))
    .rejects.toThrow('native source indexing');
  expect(update).toHaveBeenCalledOnce();
  expect(scan).not.toHaveBeenCalled();
});
