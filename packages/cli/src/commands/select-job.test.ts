import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { encodeTestCoverage, testCoverageFile } from '@variance-authority/sense/test-selection';
import { selectSuite } from './select-command.js';

const git = (root: string, ...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

/** A checkout whose `site` job read `read.txt`, listed `pages/` and looked for `absent.txt`. */
function checkout(recorded = true, complete = true): string {
  const root = mkdtempSync(join(tmpdir(), 'va-select-job-'));
  git(root, 'init', '-q');
  git(root, 'config', 'user.email', 'a@b.c');
  git(root, 'config', 'user.name', 'a');
  mkdirSync(join(root, 'pages'));
  mkdirSync(join(root, 'elsewhere'));
  writeFileSync(join(root, 'read.txt'), 'read\n');
  writeFileSync(join(root, 'written.txt'), 'written\n');
  writeFileSync(join(root, 'pages', 'one.md'), 'one\n');
  writeFileSync(join(root, 'elsewhere', 'one.md'), 'one\n');
  writeFileSync(join(root, 'variance.config.json'), JSON.stringify({ suites: { site: { kind: 'e2e', relations: false } } }));
  git(root, 'add', '.');
  git(root, 'commit', '-qm', 'one');
  if (!recorded) return root;
  const file = testCoverageFile(root, { suite: 'site' });
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, encodeTestCoverage({
    version: 3,
    instrumentation: 'job',
    commit: git(root, 'rev-parse', 'HEAD'),
    tests: [{
      file: 'site',
      complete,
      preconditions: [
        { name: 'absent.txt', digest: 'absent' },
        { name: 'pages/', digest: 'listed' },
        { name: 'read.txt', digest: 'x' },
      ],
    }],
    modules: [],
  }));
  return root;
}

const skipped = async (root: string): Promise<boolean> => {
  const { whole, skip } = await selectSuite({ root, suite: 'site' });
  expect([...whole]).toContain('site');
  return [...skip].includes('site');
};

function add(root: string, file: string): void {
  writeFileSync(join(root, file), 'new\n');
  git(root, 'add', file);
}

describe('selecting a job by what it read', () => {
  beforeEach(() => {
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-select-job-cache-')));
  });
  afterEach(() => vi.unstubAllEnvs());

  it('selects the job when a file it read changes', async () => {
    const root = checkout();
    writeFileSync(join(root, 'read.txt'), 'changed\n');
    expect(await skipped(root)).toBe(false);
  });

  it('skips the job when the file changed is one it only wrote', async () => {
    const root = checkout();
    writeFileSync(join(root, 'written.txt'), 'changed\n');
    expect(await skipped(root)).toBe(true);
  });

  it('selects a job whose record is incomplete, whatever changed', async () => {
    const root = checkout(true, false);
    writeFileSync(join(root, 'written.txt'), 'changed\n');
    const { skip } = await selectSuite({ root, suite: 'site' });
    expect([...skip]).toEqual([]);
  });

  it('selects a job that has no record', async () => {
    const root = checkout(false);
    writeFileSync(join(root, 'written.txt'), 'changed\n');
    const { skip } = await selectSuite({ root, suite: 'site' });
    expect([...skip]).toEqual([]);
  });

  it('selects the job when a file appears in a folder it listed', async () => {
    const root = checkout();
    add(root, 'pages/two.md');
    expect(await skipped(root)).toBe(false);
  });

  it('skips the job when a file appears in a folder it never listed', async () => {
    const root = checkout();
    add(root, 'elsewhere/two.md');
    expect(await skipped(root)).toBe(true);
  });

  it('selects the job when a file appears where it looked and found nothing', async () => {
    const root = checkout();
    add(root, 'absent.txt');
    expect(await skipped(root)).toBe(false);
  });
});
