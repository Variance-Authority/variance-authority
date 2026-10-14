import type { TestInfo } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { parseBaselinePath } from '@variance-authority/store/durable';
import { asRun, baselineKeyOf, runOf, type VarianceRun } from './run.js';

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
      titlePath: ['checkout', 'shows an empty cart'],
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

  it('reads the project by its name, and an unnamed one as none', () => {
    const named = { project: { name: 'mobile', use: {} } } as Partial<TestInfo>;
    const unnamed = { project: { name: '', use: {} } } as Partial<TestInfo>;

    expect(runOf(testInfo(named)).projectName).toBe('mobile');
    expect(runOf(testInfo(unnamed))).not.toHaveProperty('projectName');
  });
});

describe('baselineKeyOf', () => {
  it('names a baseline by the spec file and the title path the test was declared under', () => {
    const key = baselineKeyOf(runOf(testInfo()), 'checkout/shows an empty cart');

    expect(key).toEqual({
      subject: 'checkout/shows an empty cart',
      file: 'test/checkout.spec.ts',
      title: 'checkout',
      name: 'shows an empty cart',
    });
    // The path a reviewer reads in the pull request says which test, by its titles.
    expect(parseBaselinePath('{dir}/__baselines__/{file}/{title}/{name}-{engine}').render(key, 'chromium')).toBe(
      'test/__baselines__/checkout.spec.ts/checkout/shows-an-empty-cart-chromium',
    );
  });

  it('carries the project, so two projects can be filed apart', () => {
    const run = runOf(testInfo({ project: { name: 'mobile', use: { deviceScaleFactor: 2 } } } as Partial<TestInfo>));

    expect(baselineKeyOf(run, run.id!)).toMatchObject({ subject: 'checkout/shows an empty cart', project: 'mobile' });
    expect(baselineKeyOf(run, 'cart/empty', { named: true })).toMatchObject({ project: 'mobile' });
  });

  it('keeps a slash inside one title as one segment', () => {
    const run = runOf(testInfo({ titlePath: ['test/checkout.spec.ts', 'cart', 'adds 1/2 a pizza'] } as Partial<TestInfo>));

    expect(baselineKeyOf(run, run.id!)).toMatchObject({ title: 'cart', name: 'adds 1/2 a pizza' });
  });

  it('names an observation the test named by its own id, under the spec file', () => {
    // Several named observations in one test share its titles; the id is what tells them apart.
    expect(baselineKeyOf(runOf(testInfo()), 'cart/empty', { named: true })).toEqual({
      subject: 'cart/empty',
      file: 'test/checkout.spec.ts',
    });
  });

  it('names a descriptor run by its id alone', () => {
    expect(baselineKeyOf({ id: 'cart' }, 'cart')).toEqual({ subject: 'cart' });
  });
});

describe('asRun', () => {
  it('passes a descriptor through untouched', () => {
    const run: VarianceRun = { id: 'cart', accepting: true, deviceScaleFactor: 1 };

    expect(asRun(run)).toBe(run);
  });

  it('passes a descriptor that names its project through untouched', () => {
    const run: VarianceRun = { id: 'cart', projectName: 'mobile', accepting: true };

    expect(asRun(run)).toBe(run);
  });

  it('passes a descriptor that carries its titles through untouched', () => {
    // An rstest run is a descriptor with `titlePath`, the field a TestInfo also
    // has; it holds no `project` to be read from.
    const run: VarianceRun = { id: 'cart/empty', titlePath: ['cart', 'empty'], accepting: true, deviceScaleFactor: 1 };

    expect(asRun(run)).toBe(run);
  });

  it('reads a TestInfo rather than treating it as one', () => {
    expect(asRun(testInfo()).id).toBe('checkout/shows an empty cart');
  });
});
