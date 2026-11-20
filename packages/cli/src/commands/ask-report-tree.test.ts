import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { sourceIndexPath } from '@variance-authority/sense';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { EXIT_CLEAN } from '../exit.js';
import { checkout, run } from './ask-packages.fixture.js';
import { ask } from './ask.js';
import type { CliRunReport } from './run-report.js';

/**
 * A question about the last run that names a start point reads the tree
 * `variance index` published, as a question about the source does: it does not
 * scan the checkout, and it does not write the source index.
 */

const cwd = process.cwd();

const REPORT: CliRunReport = {
  runVersion: 1,
  at: '2026-08-01T10:00:00.000Z',
  identity: { renderer: 'playwright-chromium', engine: 'chromium@131', platform: 'linux/x64', deviceScaleFactor: 1, fonts: [] },
  retention: 'durable',
  observations: [],
};

beforeEach(() => {
  vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-report-tree-cache-')));
});

afterEach(() => {
  process.chdir(cwd);
  vi.unstubAllEnvs();
});

const locate = (from: string): Promise<string> =>
  ask({ question: 'locate', report: join(process.cwd(), 'run.json'), read: () => Promise.resolve(REPORT), query: 'greet', from });

describe('a question about the last run, from a start point', () => {
  it('refuses with nothing published, naming `variance index`, and writes no source index', async () => {
    const root = mkdtempSync(join(tmpdir(), 'va-report-tree-'));
    writeFileSync(join(root, 'package.json'), '{"name":"bare","private":true}\n');
    writeFileSync(join(root, 'a.ts'), 'export const a = 1;\n');
    process.chdir(root);

    await expect(locate('a.ts')).rejects.toThrow(/Run `variance index`/u);
    expect(existsSync(sourceIndexPath(root))).toBe(false);
  });

  it('resolves its start point in the tree `variance index` published, and writes no source index for a file added since', async () => {
    const root = checkout();
    expect((await run(['index'])).code).toBe(EXIT_CLEAN);
    const published = readFileSync(sourceIndexPath(root));

    expect(await locate('packages/lib/src/greet.ts')).not.toContain('no source tree was read');
    writeFileSync(join(root, 'packages/lib/src/fresh.ts'), 'export const fresh = 1;\n');
    await locate('packages/lib/src/fresh.ts');
    expect(readFileSync(sourceIndexPath(root)).equals(published)).toBe(true);
  });
});
