import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { chmod, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workingTreeChanges } from '../working-tree-changes.js';
import { removeSeamModules, writeSeamModule } from './selection-run.js';

// A read-only parent is how a directory is refused here, and permission bits
// bind neither the superuser nor Windows: there, nothing refuses.
const refuses = process.platform !== 'win32' && process.getuid?.() !== 0;

let project: string;

beforeEach(async () => {
  project = await mkdtemp(resolve(tmpdir(), 'variance-authority-seam-'));
});

afterEach(async () => {
  await chmod(resolve(project, 'locked'), 0o755).catch(() => undefined);
  await rm(project, { recursive: true, force: true });
});

it.runIf(refuses)('goes on past a directory it made that the platform will not let go of, and takes it off on a later call', async () => {
  const run = { made: new Set<string>() };
  const shim = writeSeamModule(run, resolve(project, 'locked', '.variance-authority', 'setup.mjs'), '');
  await chmod(resolve(project, 'locked'), 0o555);

  expect(() => removeSeamModules(run, [shim])).not.toThrow();
  expect(existsSync(shim)).toBe(false);
  expect(existsSync(dirname(shim))).toBe(true);

  await chmod(resolve(project, 'locked'), 0o755);
  removeSeamModules(run, []);
  expect(existsSync(resolve(project, 'locked'))).toBe(false);
  expect(existsSync(project)).toBe(true);
  expect(run.made).toEqual(new Set());
});

/** A real repository with one commit; `.gitignore` files are the only ignore rules it reads. */
function repository(): void {
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('XDG_CONFIG_HOME', project);
  const git = (...args: string[]): void => {
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd: project, stdio: 'ignore' });
  };
  git('init', '--quiet');
  git('commit', '--quiet', '--allow-empty', '-m', 'first');
}

describe('a module the seam writes into the checkout', () => {
  afterEach(() => vi.unstubAllEnvs());

  const shimIn = (directory: string): string => resolve(directory, '.variance-authority', 'test-selection-setup-1-a.mjs');

  it.each([
    ['at the top of the checkout', ''],
    ['in a package below it', 'packages/app/'],
  ])('is not a change to the checkout it lands in, %s', async (_, prefix) => {
    repository();
    const root = resolve(project, prefix);
    await mkdir(root, { recursive: true });
    await writeFile(resolve(root, 'edited.ts'), '');

    writeSeamModule({ made: new Set<string>() }, shimIn(root), '');

    expect(await workingTreeChanges(root, prefix)).toEqual({ changed: ['edited.ts'], gone: [] });
  });

  it('leaves a file the project keeps beside it a change, as it was before the run', async () => {
    repository();
    await mkdir(resolve(project, '.variance-authority'));
    await writeFile(resolve(project, '.variance-authority', 'journeys.bin'), '');

    writeSeamModule({ made: new Set<string>() }, shimIn(project), '');

    expect(await workingTreeChanges(project, '')).toEqual({ changed: ['.variance-authority/journeys.bin'], gone: [] });
  });

  it('takes its ignore file off with the directory the run made for it', () => {
    const run = { made: new Set<string>() };
    const shim = writeSeamModule(run, shimIn(project), '');

    removeSeamModules(run, [shim]);

    expect(existsSync(dirname(shim))).toBe(false);
  });

  it('leaves a directory the project already had as it found it', async () => {
    await mkdir(resolve(project, '.variance-authority'));
    await writeFile(resolve(project, '.variance-authority', 'journeys.bin'), '');
    const run = { made: new Set<string>() };
    const shim = writeSeamModule(run, shimIn(project), '');

    removeSeamModules(run, [shim]);

    expect(await readdir(resolve(project, '.variance-authority'))).toEqual(['journeys.bin']);
  });

  it('keeps its ignore file while a module of another run is still beside it', () => {
    const run = { made: new Set<string>() };
    const shim = writeSeamModule(run, shimIn(project), '');
    writeSeamModule({ made: new Set<string>() }, resolve(project, '.variance-authority', 'test-selection-setup-2-b.mjs'), '');

    removeSeamModules(run, [shim]);

    expect(existsSync(resolve(project, '.variance-authority', '.gitignore'))).toBe(true);
  });

  it('keeps an ignore file the project wrote there itself', async () => {
    const ignore = resolve(project, '.variance-authority', '.gitignore');
    await mkdir(dirname(ignore));
    await writeFile(ignore, 'test-selection-*\n');
    const run = { made: new Set<string>() };
    const shim = writeSeamModule(run, shimIn(project), '');

    removeSeamModules(run, [shim]);

    expect(await readFile(ignore, 'utf8')).toBe('test-selection-*\n');
  });
});
