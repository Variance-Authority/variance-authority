import { existsSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { testCoverageFile } from './index.js';
import { landJob } from './job-record.js';

vi.mock('./index-lock.js', async (original) => ({
  ...(await original<typeof import('./index-lock.js')>()),
  withIndexLock: async () => ({ held: false }),
}));

beforeEach(() => void vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-job-busy-cache-'))));
afterEach(() => vi.unstubAllEnvs());

it('refuses to land over another writer: a job left short under a clean exit would be skipped wrongly', async () => {
  const root = mkdtempSync(join(tmpdir(), 'va-job-busy-'));
  writeFileSync(join(root, 'variance.config.json'), JSON.stringify({ suites: { 'site-job': { kind: 'e2e', relations: false } } }));
  const step = { root, suite: 'site-job', commit: 'c1', complete: true, trace: { reads: new Set<string>(), writes: new Set<string>() }, tracked: new Map() };
  await expect(landJob(step)).rejects.toThrow(/another process is holding/);
  expect(existsSync(testCoverageFile(root, { suite: 'site-job' }))).toBe(false);
});
