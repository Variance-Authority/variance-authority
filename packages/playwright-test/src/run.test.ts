import type { TestInfo } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { asRun, runOf, type VarianceRun } from './run.js';

/**
 * The seam exists so a suite need not lie about its runner.
 *
 * A project driving Playwright from vitest or a script has every fact this
 * package reads and no `TestInfo` to put them in. These assert the two
 * directions that matters in: a real `TestInfo` still answers exactly what it
 * used to, and a descriptor is taken as itself rather than being probed for
 * runner fields it will never have.
 */

function testInfo(overrides: Partial<TestInfo> = {}): TestInfo {
  return {
    titlePath: ['chromium', 'checkout', 'shows an empty cart'],
    file: `${process.cwd()}/test/checkout.spec.ts`,
    status: 'passed',
    config: { updateSnapshots: 'missing' },
    project: { use: { colorScheme: 'dark', deviceScaleFactor: 2, baseURL: 'http://localhost:3000' } },
    ...overrides,
  } as unknown as TestInfo;
}

describe('runOf', () => {
  it('reads the subject, the raster partition and the origin from one TestInfo', () => {
    expect(runOf(testInfo())).toEqual({
      id: 'checkout/shows an empty cart',
      colorScheme: 'dark',
      deviceScaleFactor: 2,
      baseURL: 'http://localhost:3000',
      owner: 'test/checkout.spec.ts',
      accepting: false,
      failed: false,
    });
  });

  it('accepts only under an explicit update mode', () => {
    const flags = ['missing', 'none', 'all', 'changed'] as const;
    const accepting = flags.map(
      (updateSnapshots) => runOf(testInfo({ config: { updateSnapshots } } as Partial<TestInfo>)).accepting,
    );

    // `missing` is the flag's absence, not approval: promoting under it would
    // write a baseline from the same unreviewed run that reported the change.
    expect(accepting).toEqual([false, false, true, true]);
  });

  it('records no owner when the runner built no spec file', () => {
    expect(runOf(testInfo({ file: undefined } as Partial<TestInfo>))).not.toHaveProperty('owner');
  });
});

describe('asRun', () => {
  it('passes a descriptor through untouched', () => {
    const run: VarianceRun = { id: 'cart', accepting: true, deviceScaleFactor: 1 };

    expect(asRun(run)).toBe(run);
  });

  it('reads a TestInfo rather than treating it as one', () => {
    expect(asRun(testInfo()).id).toBe('checkout/shows an empty cart');
  });
});
