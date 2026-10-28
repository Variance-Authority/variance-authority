import { afterEach, describe, expect, it } from 'vitest';

import { varianceBreadcrumb } from './index.js';

const BREADCRUMB = Symbol.for('variance-authority.test-selection.breadcrumb');
const scope = globalThis as Record<symbol, unknown>;

afterEach(() => {
  delete scope[BREADCRUMB];
});

describe('varianceBreadcrumb', () => {
  it('returns the value it read, and costs one property read where nothing records', () => {
    let reads = 0;
    Object.defineProperty(globalThis, BREADCRUMB, {
      configurable: true,
      get: () => {
        reads += 1;
        return undefined;
      },
    });
    const flags = { 'new-checkout': true };

    expect(varianceBreadcrumb('flags', 'new-checkout', flags['new-checkout'])).toBe(true);
    expect(varianceBreadcrumb('flags', 'variant', flags)).toBe(flags);
    expect(reads).toBe(2);
  });

  it('asks whether a read is new, and hands a new one the call site', () => {
    const calls: unknown[][] = [];
    let fresh = true;
    scope[BREADCRUMB] = (...args: unknown[]) => {
      calls.push(args);
      return args.length === 3 && fresh;
    };

    varianceBreadcrumb('flags', 'new-checkout', true);
    fresh = false;
    varianceBreadcrumb('flags', 'new-checkout', true);

    expect(calls.map((call) => call.length)).toEqual([3, 4, 3]);
    expect(calls[1]!.slice(0, 3)).toEqual(['flags', 'new-checkout', true]);
    expect((calls[1]![3] as Error).stack).toMatch(/breadcrumb\.test\.ts:\d+/);
  });

  it('never throws, and still returns the value, when the recorder throws', () => {
    scope[BREADCRUMB] = () => {
      throw new Error('a recorder bug');
    };

    expect(varianceBreadcrumb('flags', 'new-checkout', 'on')).toBe('on');
  });
});
