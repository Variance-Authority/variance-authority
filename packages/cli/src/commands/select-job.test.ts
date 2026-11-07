import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { landJob } from '@variance-authority/sense/test-selection';
import { selectSuite } from './select-command.js';

const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

/** A checkout whose `site` job read `read.txt` and wrote `written.txt`, landed as a run lands it. */
async function checkout(recorded = true, complete = true): Promise<string> {
  const root = mkdtempSync(join(tmpdir(), 'va-select-job-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'a@b.c');
  git(root, 'config', 'user.name', 'a');
  writeFileSync(join(root, 'read.txt'), 'read\n');
  writeFileSync(join(root, 'written.txt'), 'written\n');
  writeFileSync(join(root, 'variance.config.json'), JSON.stringify({ suites: { site: { kind: 'e2e', relations: false } } }));
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'one');
  if (!recorded) return root;
  await landJob({
    root,
    suite: 'site',
    commit: git(root, 'rev-parse', 'HEAD'),
    complete,
    at: '2026-11-07T00:00:00.000Z',
    trace: { reads: new Set([join(root, 'read.txt')]), writes: new Set([join(root, 'written.txt')]) },
    tracked: new Map([['read.txt', git(root, 'rev-parse', 'HEAD:read.txt')], ['written.txt', git(root, 'rev-parse', 'HEAD:written.txt')]]),
  });
  return root;
}

const skipped = async (root: string): Promise<boolean> => {
  const { whole, skip } = await selectSuite({ root, suite: 'site' });
  expect([...whole]).toContain('site');
  return [...skip].includes('site');
};

describe('selecting a job by what it read', () => {
  beforeEach(() => {
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-select-job-cache-')));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('selects the job when a file it read changes', async () => {
    const root = await checkout();
    writeFileSync(join(root, 'read.txt'), 'changed\n');
    expect(await skipped(root)).toBe(false);
  });

  it('skips the job when the file changed is one it only wrote', async () => {
    const root = await checkout();
    writeFileSync(join(root, 'written.txt'), 'changed\n');
    expect(await skipped(root)).toBe(true);
  });

  it('selects a job whose record is incomplete, whatever changed', async () => {
    const root = await checkout(true, false);
    writeFileSync(join(root, 'written.txt'), 'changed\n');
    const { skip } = await selectSuite({ root, suite: 'site' });
    expect([...skip]).toEqual([]);
  });

  it('selects a job that has no record', async () => {
    const root = await checkout(false);
    writeFileSync(join(root, 'written.txt'), 'changed\n');
    const { skip } = await selectSuite({ root, suite: 'site' });
    expect([...skip]).toEqual([]);
  });
});
