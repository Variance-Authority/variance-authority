import { describe, expect, it, vi } from 'vitest';
import { recordCargo } from './cargo-recording.js';

// An addon built before Rust coverage: it loads, and has no `rustCoverage`.
vi.mock('../addon.js', () => ({ native: () => ({}), nativeRefusal: () => undefined }));

describe('recording a Cargo suite with an addon that cannot read Rust profiles', () => {
  it('refuses before building anything, naming the entry the addon lacks', async () => {
    await expect(recordCargo({ cwd: '/nonexistent' })).rejects.toThrow(/requires the Sense native addon: .*rustCoverage/);
  });
});
