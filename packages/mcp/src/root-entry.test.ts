import { describe, expect, it, vi } from 'vitest';

/**
 * What a caller pays to import the root entry.
 *
 * The root exports pure functions beside the servers that compose them, and
 * Node evaluates every static import of an entry whether the caller uses it or
 * not. So a caller that asks for `locateSubjects` must not evaluate what only a
 * started server reads: the served tool sets, the execution-index reader, Eyes,
 * the run report file and the live-run listener. Each is watched where it is
 * first evaluated, and the last case shows the watch sees a real import.
 */

const evaluated = vi.hoisted(() => [] as string[]);

vi.mock('./tools.js', async (original) => {
  evaluated.push('the served tool sets');
  return original();
});
vi.mock('@variance-authority/sense/test-selection', async (original) => {
  evaluated.push('the execution-index reader');
  return original();
});
vi.mock('@variance-authority/eyes', async (original) => {
  evaluated.push('Eyes');
  return original();
});
vi.mock('@variance-authority/report/file', async (original) => {
  evaluated.push('the run report file');
  return original();
});
vi.mock('@variance-authority/vantage/attach', async (original) => {
  evaluated.push('the live-run listener');
  return original();
});

describe('the root entry', () => {
  it('evaluates nothing a server reads until a server is started', async () => {
    const root = await import('./index.js');

    expect(typeof root.locateSubjects).toBe('function');
    expect(typeof root.serve).toBe('function');
    expect(evaluated).toEqual([]);
  });

  it('evaluates the served tool sets once a served set is asked for', async () => {
    await import('./protocol.js');

    expect(evaluated).toContain('the served tool sets');
  });
});
