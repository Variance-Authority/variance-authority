import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { native, nativeAvailable } from './addon.js';

/** The files a scan reads before it opens the object store: `STORE_CROSSOVER` in `git_store.rs`. */
const CROSSOVER = 3_000;
/** Writing and committing a crossover's worth of files takes seconds on a loaded machine. */
const FIXTURE_TIMEOUT = 30_000;

it.runIf(nativeAvailable())('reads local blobs and worktree fallbacks without fetching missing objects', () => {
  const root = mkdtempSync(join(tmpdir(), 'sense-local-blobs-'));
  const git = (...args: string[]): string => execFileSync('git', args, {
    cwd: root, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.test',
      GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.test',
    },
  }).trim();
  try {
    git('init', '--quiet');
    // Three thousand loose objects start a detached `git maintenance`, which would pack the object deleted below.
    git('config', 'maintenance.auto', 'false');
    for (let index = 0; index < CROSSOVER; index += 1) {
      writeFileSync(join(root, `${index}.ts`), `export const value = ${index};\n`);
    }
    git('add', '.');
    git('commit', '--quiet', '-m', 'source');
    const missing = git('rev-parse', 'HEAD:1.ts');
    unlinkSync(join(root, '.git', 'objects', missing.slice(0, 2), missing.slice(2)));
    const remote = join(root, '.git', 'empty-remote.git');
    git('init', '--bare', '--quiet', remote);
    git('config', 'remote.origin.url', remote);
    git('config', 'remote.origin.promisor', 'true');
    git('config', 'remote.origin.partialclonefilter', 'blob:none');
    writeFileSync(join(root, '0.ts'), "export { value } from './2';\n");
    writeFileSync(join(root, 'untracked.ts'), "export { value } from './3';\n");

    const addon = native()!;
    const tree = addon.gitTreeFor(root, ['.'])!;
    const files = tree.seeds();
    const trace = join(root, '.git', 'acquisition-trace.json');
    vi.stubEnv('GIT_TRACE2_EVENT', trace);
    vi.stubEnv('GIT_NO_LAZY_FETCH', '0');
    const packed = tree.scanBatch(root, files, undefined, true, 1);
    const disk = addon.scanBatch(root, files, undefined, true, 1);
    expect(packed).toEqual(disk);
    const events = readFileSync(trace, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    // The store is read in-process: opening it asks Git where it lies and its object format.
    expect(events.some((event) => event.event === 'start' && event.argv?.includes('--show-object-format'))).toBe(true);
    const commands = events.filter((event) => event.event === 'child_start').map((event) => event.argv);
    expect(commands.filter((args: string[]) => args.includes('fetch'))).toEqual([]);
    expect(files).toHaveLength(CROSSOVER + 1);
    expect(packed.values).toContain('./2');
    expect(packed.values).toContain('./3');
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
}, FIXTURE_TIMEOUT);

it.runIf(nativeAvailable())('opens the store once two scans of one tree have read the crossover between them', () => {
  const root = mkdtempSync(join(tmpdir(), 'sense-tree-store-'));
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, stdio: 'pipe' });
  };
  try {
    git('init', '--quiet');
    git('config', 'maintenance.auto', 'false');
    for (let index = 0; index < CROSSOVER; index += 1) {
      writeFileSync(join(root, `${index}.ts`), `export const value = ${index};\n`);
    }
    git('add', '.');
    git('commit', '--quiet', '-m', 'source');
    const tree = native()!.gitTreeFor(root, ['.'])!;
    const files = tree.seeds();
    const half = files.length / 2;
    // A scan that asks git nothing writes no trace.
    const opened = (trace: string): boolean => existsSync(trace) && readFileSync(trace, 'utf8').trim().split('\n')
      .map((line) => JSON.parse(line))
      .some((event) => event.event === 'start' && event.argv?.includes('--show-object-format'));

    const first = join(root, '.git', 'first-trace.json');
    vi.stubEnv('GIT_TRACE2_EVENT', first);
    tree.scanBatch(root, files.slice(0, half), undefined, true, 1);
    const second = join(root, '.git', 'second-trace.json');
    vi.stubEnv('GIT_TRACE2_EVENT', second);
    tree.scanBatch(root, files.slice(half), undefined, true, 1);
    const third = join(root, '.git', 'third-trace.json');
    vi.stubEnv('GIT_TRACE2_EVENT', third);
    tree.scanBatch(root, files.slice(0, half), undefined, true, 1);

    expect(files).toHaveLength(CROSSOVER);
    expect(opened(first), 'a scan under the crossover reads from disk').toBe(false);
    expect(opened(second), 'the scan that brings the tree to the crossover opens the store').toBe(true);
    expect(opened(third), 'a later scan reads from the store already open').toBe(false);
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
}, FIXTURE_TIMEOUT);
