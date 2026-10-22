import { describe, expect, it, vi } from 'vitest';

/**
 * What a caller pays to import the root entry.
 *
 * The root exports the workspace readers beside `serveWorkspace`, and Node
 * evaluates every static import of an entry whether the caller uses it or not.
 * `serveWorkspace` starts its server through `serve` from
 * `@variance-authority/mcp`, so the root must not evaluate what only a started
 * report server reads: the report server's served sets, Eyes, the run report
 * file and the live-run listener. The readers still evaluate the tool-authoring
 * kit and every report tool through `@variance-authority/mcp/tools`; this file
 * does not watch that. The last case shows the watch sees a real import.
 */

const evaluated = vi.hoisted(() => [] as string[]);

vi.mock('@variance-authority/mcp/protocol', async (original) => {
  evaluated.push('the report server’s served sets');
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
  it('evaluates none of what a started report server reads', async () => {
    const root = await import('./index.js');

    expect(typeof root.readWorkspace).toBe('function');
    expect(typeof root.serveWorkspace).toBe('function');
    expect(evaluated).toEqual([]);
  });

  it('evaluates the report server’s served sets once they are asked for', async () => {
    await import('@variance-authority/mcp/protocol');

    expect(evaluated).toContain('the report server’s served sets');
  });
});
