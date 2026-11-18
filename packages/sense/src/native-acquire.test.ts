import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { native, nativeAvailable } from './addon.js';

it.runIf(nativeAvailable())('reads local blobs and dirty files, and reports missing indexed objects without fetching', () => {
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
    git('config', 'maintenance.auto', 'false');
    for (let index = 0; index < 4; index += 1) {
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
    const absent = files.indexOf('1.ts');
    expect(absent).toBeGreaterThanOrEqual(0);
    expect(packed.parsed[absent]).toBe(0);
    expect(packed.unknown[absent]).toContain('could not be read from Git');
    expect(packed.digests[absent]).toBe('');
    expect(disk.parsed[absent]).toBe(1);
    const available = files.filter((file) => file !== '1.ts');
    expect(tree.scanBatch(root, available, undefined, true, 1)).toEqual(addon.scanBatch(root, available, undefined, true, 1));
    const events = readFileSync(trace, 'utf8').trim().split('\n').map((line) => JSON.parse(line));
    // The store is read in-process: opening it asks Git where it lies and its object format.
    expect(events.some((event) => event.event === 'start' && event.argv?.includes('--show-object-format'))).toBe(true);
    const commands = events.filter((event) => event.event === 'child_start').map((event) => event.argv);
    expect(commands.filter((args: string[]) => args.includes('fetch'))).toEqual([]);
    expect(files).toHaveLength(5);
    expect(packed.values).toContain('./2');
    expect(packed.values).toContain('./3');
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});

it.runIf(nativeAvailable())('opens one Git store for the first indexed scan and reuses it across later scans', () => {
  const root = mkdtempSync(join(tmpdir(), 'sense-tree-store-'));
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', ...args], { cwd: root, stdio: 'pipe' });
  };
  try {
    git('init', '--quiet');
    git('config', 'maintenance.auto', 'false');
    for (let index = 0; index < 2; index += 1) {
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

    expect(files).toHaveLength(2);
    expect(opened(first), 'the first indexed scan opens the store').toBe(true);
    expect(opened(second), 'the next scan reuses the open store').toBe(false);
    expect(opened(third), 'a later scan reads from the store already open').toBe(false);
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
