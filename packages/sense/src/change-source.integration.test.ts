import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { copyFileSync, cpSync } from 'node:fs';
import { chmod, mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { updateNatively } from './native-update.js';
import { updateSourceIndex } from './published.js';
import { realPath } from './resolve.js';

const SERVER = fileURLToPath(new URL('../test/fixtures/watchman-server.mjs', import.meta.url));

/**
 * Spec 0107: the update asks Watchman what moved since the clock its
 * generation carries, and asks git only what Watchman cannot vouch for.
 */
describe.skipIf(process.platform === 'win32')('the update over a watched checkout', () => {
  let root: string;
  let work: string;
  let wire: string;
  let server: ChildProcess;
  let path: string | undefined;
  let socket: string | undefined;
  let index: string;
  let step = 0;

  const answers = () => join(wire, 'answers.json');
  const asked = () => join(wire, 'git.log');

  async function tell(told: { roots?: string[]; clock?: string; fresh?: boolean; files?: unknown[]; config?: unknown }): Promise<void> {
    await writeFile(answers(), JSON.stringify({ roots: [root], clock: 'c:1:1', ...told }));
  }

  /** The git commands the addon ran since the last call, one per line. */
  async function gitRan(): Promise<string[]> {
    const ran = (await readFile(asked(), 'utf8').catch(() => '')).split('\n').filter(Boolean);
    await writeFile(asked(), '');
    return ran;
  }

  /**
   * A file dated a minute back. One written in the second git writes its index
   * in is racy, and `status` rewrites the index for it on every call: a listing
   * no stamp can vouch for until that second has passed. An edit is dated by
   * `ago` apart from the setup's, or git, seeing the same size and second, keeps it.
   */
  async function write(file: string, text: string, ago = 60_000): Promise<void> {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), text);
    const past = new Date(Date.now() - ago);
    await utimes(join(root, file), past, past);
  }

  function git(...args: string[]): void {
    execFileSync('git', args, { cwd: root, stdio: 'ignore' });
  }

  beforeAll(async () => {
    root = realPath(await mkdtemp(join(tmpdir(), 'variance-change-source-')));
    work = realPath(await mkdtemp(join(tmpdir(), 'variance-change-source-index-')));
    // A socket path is limited to about a hundred bytes, which a macOS temporary directory spends half of.
    wire = realPath(await mkdtemp('/tmp/vawm-'));
    await write('package.json', '{ "name": "fixture" }');
    await write('app/index.ts', "import { unit } from '../lib/unit.js';\nexport const app = unit;\n");
    await write('lib/unit.ts', 'export const unit = 1;\n');
    await write('.gitignore', 'cache/\n');
    await write('cache/kept.ts', 'export const kept = 1;\n');
    git('init', '--quiet');
    git('add', '.');
    git('add', '--force', 'cache/kept.ts');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'fixture');

    // Every git the addon spawns writes its arguments down: what the update asked git is counted, not timed.
    const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    const bin = join(wire, 'bin');
    await mkdir(bin);
    await writeFile(join(bin, 'git'), `#!/bin/sh\necho "$*" >> '${asked()}'\nexec '${real}' "$@"\n`);
    await chmod(join(bin, 'git'), 0o755);

    // CI runs no Watchman: the server is a fixture speaking its protocol, and the client is the addon's.
    await tell({});
    const requests = join(wire, 'requests.log');
    server = spawn(process.execPath, [SERVER, join(wire, 'sock'), answers(), requests], { stdio: ['ignore', 'pipe', 'inherit'] });
    await new Promise<void>((ready, failed) => {
      server.stdout!.once('data', () => ready());
      server.once('error', failed);
    });

    path = process.env.PATH;
    socket = process.env.WATCHMAN_SOCK;
    process.env.PATH = `${bin}:${path ?? ''}`;
    process.env.WATCHMAN_SOCK = join(wire, 'sock');
  });

  afterAll(async () => {
    process.env.PATH = path;
    if (socket === undefined) delete process.env.WATCHMAN_SOCK;
    else process.env.WATCHMAN_SOCK = socket;
    server?.kill();
    await rm(root, { recursive: true, force: true });
    await rm(work, { recursive: true, force: true });
    await rm(wire, { recursive: true, force: true });
  });

  beforeEach(async () => {
    index = join(work, `index-${step++}`, 'index.bin');
    await mkdir(dirname(index), { recursive: true });
    await tell({});
    await updateSourceIndex(root, { index });
    await gitRan();
  });

  it('runs no git when Watchman reports nothing since the clock the update recorded', async () => {
    const first = await updateNatively(root, index);
    expect(await gitRan()).not.toEqual([]);

    await tell({ clock: 'c:1:2' });
    const told: string[] = [];
    const second = await updateNatively(root, index, (step) => void told.push(step));
    expect(await gitRan()).toEqual([]);
    expect(told).toContain('Watchman reports nothing moved since the listing the index holds, so git listed nothing');
    expect(second).toMatchObject({ files: first!.files, reread: 0 });
    expect(second!.listing.paths()).toEqual(first!.listing.paths());
  });

  it('asks git when Watchman starts over, and when the clock names a file git does not ignore', async () => {
    await updateNatively(root, index);
    await gitRan();

    await tell({ clock: 'c:2:1', fresh: true });
    await updateNatively(root, index);
    expect((await gitRan()).some((ran) => ran.startsWith('ls-tree'))).toBe(true);

    await write('lib/unit.ts', 'export const unit = 2;\n', 30_000);
    await tell({ clock: 'c:2:2', files: ['lib/unit.ts'] });
    const edited = await updateNatively(root, index);
    expect((await gitRan()).some((ran) => ran.startsWith('ls-tree'))).toBe(true);
    expect(edited?.reread).toBe(1);
    await write('lib/unit.ts', 'export const unit = 1;\n');
  });

  it('asks git only whether it ignores the paths Watchman reports, when it ignores every one', async () => {
    await updateNatively(root, index);
    await gitRan();

    // A directory is in no listing: what moved inside it is reported apart.
    await tell({ clock: 'c:3:1', files: ['cache/out.js', 'cache/deep/map.json', { name: 'lib', type: 'd' }] });
    const ignored = await updateNatively(root, index);
    expect((await gitRan()).map((ran) => ran.split(' ')[0])).toEqual(['check-ignore']);
    expect(ignored).toMatchObject({ reread: 0 });

    // Tracked, so not ignored, though the pattern matches it.
    await tell({ clock: 'c:3:2', files: ['cache/out.js', 'cache/kept.ts'] });
    await updateNatively(root, index);
    expect((await gitRan()).some((ran) => ran.startsWith('ls-tree'))).toBe(true);
  });

  it("runs no git when what Watchman reports is git's own writes to its directory", async () => {
    await updateNatively(root, index);
    await gitRan();

    // Every `status` takes `.git/index.lock`; what git's directory holds is the input stamps' to vouch for.
    await tell({ clock: 'c:6:1', files: [{ name: '.git', type: 'd' }, '.git/index.lock', '.git/logs/HEAD'] });
    await updateNatively(root, index);
    expect(await gitRan()).toEqual([]);
  });

  it("carries a listing whose files' stat differs from the index's, which leaves the index as it was", async () => {
    await updateNatively(root, index);
    await gitRan();

    // The same text with another date: a `status` that may write the index refreshes its entry.
    await write('lib/unit.ts', 'export const unit = 1;\n', 45_000);
    await tell({ clock: 'c:7:1', files: ['lib/unit.ts'] });
    await updateNatively(root, index);
    await gitRan();

    await tell({ clock: 'c:7:2' });
    await updateNatively(root, index);
    expect(await gitRan()).toEqual([]);
  });

  it('asks git when a commit moves HEAD, though Watchman reports only what moved in git\'s directory', async () => {
    await updateNatively(root, index);
    await gitRan();

    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '--allow-empty', '-m', 'moved');
    await tell({ clock: 'c:8:1', files: ['.git/index.lock', '.git/logs/HEAD'] });
    await updateNatively(root, index);
    expect((await gitRan()).some((ran) => ran.startsWith('ls-tree'))).toBe(true);
  });

  it('asks git when the excludes file a home-relative `core.excludesfile` names changes', async () => {
    const home = join(wire, 'home');
    await mkdir(home, { recursive: true });
    await writeFile(join(home, 'ignore'), '');
    const at = process.env.HOME;
    process.env.HOME = home;
    git('config', 'core.excludesfile', '~/ignore');
    await write('notes.ts', 'export const notes = 1;\n');
    try {
      await updateNatively(root, index);
      await gitRan();

      // Outside the watch, so Watchman has nothing to report.
      await writeFile(join(home, 'ignore'), 'notes.ts\n');
      await tell({ clock: 'c:9:1' });
      await updateNatively(root, index);
      expect((await gitRan()).some((ran) => ran.startsWith('ls-tree'))).toBe(true);
    } finally {
      process.env.HOME = at;
      git('config', '--unset', 'core.excludesfile');
      await rm(join(root, 'notes.ts'));
    }
  });

  it('asks git for a checkout other than the one the held listing was made against', async () => {
    await updateNatively(root, index);
    await gitRan();

    // A clone of the checkout, watched by the same server, updating the same index.
    const other = realPath(await mkdtemp(join(tmpdir(), 'variance-change-source-other-')));
    try {
      execFileSync('git', ['clone', '--quiet', root, other], { stdio: 'ignore' });
      await tell({ roots: [root, other], clock: 'c:10:1' });
      await updateNatively(other, index);
      expect((await gitRan()).some((ran) => ran.startsWith('ls-tree'))).toBe(true);
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it('updates the index another writer replaced after the listing was vouched for', async () => {
    // An index made while the file read otherwise, standing in for a writer beside this one.
    const other = join(dirname(index), 'other.bin');
    await write('lib/unit.ts', 'export const unit = 2;\n', 30_000);
    await updateSourceIndex(root, { index: other });
    await write('lib/unit.ts', 'export const unit = 1;\n');
    await updateNatively(root, index);
    await gitRan();

    await tell({ clock: 'c:11:1' });
    const updated = await updateNatively(root, index, (step) => {
      if (step.startsWith('reading the files')) {
        cpSync(`${other}.segments`, `${index}.segments`, { recursive: true });
        copyFileSync(other, index);
      }
      return () => {};
    });
    expect(updated?.listing.vouched).toBe(true);
    expect(updated?.reread).toBe(1);
  });

  it('asks git when the watch leaves out a directory the checkout tracks files in', async () => {
    await write('.hg/kept.ts', 'export const kept = 1;\n');
    await write('vendor/kept.ts', 'export const kept = 1;\n');
    git('add', '.hg/kept.ts', 'vendor/kept.ts');
    git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'vcs');
    try {
      // Watchman's default `ignore_vcs` is `.git`, `.svn` and `.hg`: what moves in them is never reported.
      await updateNatively(root, index);
      await gitRan();
      await tell({ clock: 'c:12:1' });
      await updateNatively(root, index);
      expect((await gitRan()).some((ran) => ran.startsWith('ls-tree'))).toBe(true);

      await tell({ clock: 'c:12:2', config: { ignore_vcs: ['vendor'] } });
      await updateNatively(root, index);
      await gitRan();
      await tell({ clock: 'c:12:3', config: { ignore_vcs: ['vendor'] } });
      await updateNatively(root, index);
      expect((await gitRan()).some((ran) => ran.startsWith('ls-tree'))).toBe(true);
    } finally {
      git('rm', '--quiet', '.hg/kept.ts', 'vendor/kept.ts');
      git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'no vcs');
    }
  });

  it('asks the watchman command where its server listens once for an index, not on every update', async () => {
    const bin = join(wire, 'cli');
    await mkdir(bin, { recursive: true });
    const named = join(wire, 'cli.log');
    await writeFile(join(bin, 'watchman'), `#!/bin/sh\necho "$*" >> '${named}'\necho '{"sockname":"${join(wire, 'sock')}"}'\n`);
    await chmod(join(bin, 'watchman'), 0o755);
    const at = { path: process.env.PATH, socket: process.env.WATCHMAN_SOCK };
    process.env.PATH = `${bin}:${at.path ?? ''}`;
    delete process.env.WATCHMAN_SOCK;
    try {
      // A server that watches something else: every update lists with git, and none asks the command again.
      await tell({ roots: ['/elsewhere'] });
      for (let update = 0; update < 3; update++) await updateNatively(root, index);
      expect((await readFile(named, 'utf8')).trim().split('\n')).toHaveLength(1);
    } finally {
      process.env.PATH = at.path;
      process.env.WATCHMAN_SOCK = at.socket;
    }
  });

  it('asks git when nothing listens at the socket', async () => {
    const at = process.env.WATCHMAN_SOCK;
    process.env.WATCHMAN_SOCK = join(wire, 'nobody');
    try {
      await updateNatively(root, index);
      await gitRan();
      await updateNatively(root, index);
      expect((await gitRan()).some((ran) => ran.startsWith('ls-tree'))).toBe(true);
    } finally {
      process.env.WATCHMAN_SOCK = at;
    }
  });
});
