import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { native, nativeAvailable } from './native.js';

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
    for (let index = 0; index < 160; index += 1) {
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
    expect(events.some((event) => event.event === 'start' && event.argv?.includes('cat-file'))).toBe(true);
    const commands = events.filter((event) => event.event === 'child_start').map((event) => event.argv);
    expect(commands.filter((args: string[]) => args.includes('fetch'))).toEqual([]);
    expect(files).toHaveLength(161);
    expect(packed.values).toContain('./2');
    expect(packed.values).toContain('./3');
  } finally {
    vi.unstubAllEnvs();
    rmSync(root, { recursive: true, force: true });
  }
});
