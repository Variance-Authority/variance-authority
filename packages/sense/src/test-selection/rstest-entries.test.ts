import { describe, expect, it } from 'vitest';

import { buildsTestFile } from './rstest-entries.js';

describe('buildsTestFile', () => {
  it('reads a loaded file Rspack spells with forward slashes as the same file on Windows', () => {
    expect(buildsTestFile({ setup: 'C:/repo/setup.ts' }, new Set(['C:\\repo\\setup.ts']))).toBe(false);
  });

  it('reads a file no loaded file names as a test file', () => {
    expect(buildsTestFile({ setup: 'C:/repo/setup.ts', a: 'C:/repo/a.test.ts' }, new Set(['C:\\repo\\setup.ts']))).toBe(true);
  });
});
