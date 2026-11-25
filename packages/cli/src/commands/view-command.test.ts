import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheRootFor, encodeTestCoverage, testCoverageFile } from '@variance-authority/sense/test-selection';
import { viewOutput } from './view-command.js';

/** What `variance view` writes and prints: one file at a fixed place, and a page even when coverage cannot be counted. */

let root: string;

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-view-cache-')));
  root = mkdtempSync(join(tmpdir(), 'va-view-'));
  execFileSync('git', ['init', '--quiet', root]);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function record(): void {
  const at = testCoverageFile(root, {});
  mkdirSync(dirname(at), { recursive: true });
  writeFileSync(
    at,
    encodeTestCoverage({
      version: 3,
      instrumentation: 'fixture',
      tests: [{ file: 'a.test.ts', duration: 5, start: 1_800_000_000_000, complete: true, preconditions: [] }],
      modules: [],
    }),
  );
}

describe('variance view', () => {
  it('writes the page at the cache path, prints that path, and reads the recording into it', async () => {
    record();

    const { out } = await viewOutput({ command: 'view' }, root);

    const path = `${cacheRootFor(root)}/variance-view.html`;
    expect(out).toBe(`${path}\n`);
    expect(existsSync(path)).toBe(true);
    expect(readFileSync(path, 'utf8')).toContain('a.test.ts');
  });

  it('still writes the page when coverage cannot be counted, and says why on stderr and in the page', async () => {
    const { out, err } = await viewOutput({ command: 'view' }, root);

    expect(err).toMatch(/^view: coverage was not counted: /);
    const html = readFileSync(out.trim(), 'utf8');
    expect(html).toContain('not counted');
  });
});
