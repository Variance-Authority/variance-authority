import { describe, expect, it, vi } from 'vitest';
import { recordPython } from './python-recording.js';

// An addon built before Python coverage: it loads, and has no `pythonCoverage`.
vi.mock('../addon.js', () => ({ native: () => ({}), nativeRefusal: () => undefined }));

describe('recording a pytest suite with an addon that cannot cut Python', () => {
  it('refuses before running anything, naming the entry the addon lacks', async () => {
    await expect(recordPython({ cwd: '/nonexistent' })).rejects.toThrow(/requires the Sense native addon: .*pythonCoverage/);
  });
});
