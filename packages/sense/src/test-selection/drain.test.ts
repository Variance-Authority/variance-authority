import { afterEach, describe, expect, it, vi } from 'vitest';
import { claimPageSource, drainExecution, type EvaluatingPage } from './drain.js';
import { DRIVEN_GLOBAL, EXECUTION_GLOBAL } from './execution-global.js';

/** A page that evaluates here, where the globals a test stubs are the page's. */
const here: EvaluatingPage = { evaluate: async (body, argument) => body(argument) };
const driven = (): unknown => (globalThis as Record<string, unknown>)[DRIVEN_GLOBAL];

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as Record<string, unknown>)[DRIVEN_GLOBAL];
});

describe('a driver claims the page it drains', () => {
  it('claims as it drains, so a page that reports itself stops', async () => {
    const journal = { instrumentation: 'regions', modules: [] };
    vi.stubGlobal(EXECUTION_GLOBAL, { drain: () => journal });
    expect(driven()).toBeUndefined();
    await expect(drainExecution(here)).resolves.toBe(journal);
    expect(driven()).toBe(true);
  });

  it('claims a page that has no collector yet', async () => {
    await expect(drainExecution(here)).resolves.toBeUndefined();
    expect(driven()).toBe(true);
  });

  it('claims before the page runs, from a script a driver installs', () => {
    new Function(claimPageSource())();
    expect(driven()).toBe(true);
  });
});
