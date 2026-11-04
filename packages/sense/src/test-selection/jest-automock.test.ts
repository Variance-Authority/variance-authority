import { describe, expect, it } from 'vitest';
import { SELECTION_GLOBALS, withTestSelection } from './jest.js';

describe('withTestSelection under automock', () => {
  it('keeps its own collector out of automock, beside the patterns the project keeps out', () => {
    const configured = withTestSelection(
      { rootDir: '/repo', automock: true, unmockedModulePathPatterns: ['/styles/'] },
      { coverageFile: 'coverage.bin' },
    );
    const patterns = (configured['unmockedModulePathPatterns'] as string[]).map((pattern) => new RegExp(pattern));

    expect(patterns.some((pattern) => pattern.test(SELECTION_GLOBALS))).toBe(true);
    expect(patterns.some((pattern) => pattern.test('/repo/styles/stub.cjs'))).toBe(true);
    expect(patterns.some((pattern) => pattern.test('/repo/src/math.ts'))).toBe(false);
  });
});
