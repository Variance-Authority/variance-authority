import { existsSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { vi } from 'vitest';

/** The Git commands `run` started, as argv, read from Git's own trace. */
export function gitStarted(root: string, run: () => void): string[][] {
  const trace = resolve(root, '.git', 'variance-trace.json');
  rmSync(trace, { force: true });
  vi.stubEnv('GIT_TRACE2_EVENT', trace);
  try {
    run();
  } finally {
    vi.unstubAllEnvs();
  }
  const lines = existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n') : [];
  return lines
    .map((line) => JSON.parse(line) as { event: string; argv?: string[] })
    .filter((event) => event.event === 'start')
    .map((event) => event.argv ?? []);
}
