import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
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
 *
 * The server is a fixture speaking Watchman's protocol, because CI does not run
 * Watchman; the client is the addon's. Every git the addon spawns goes through
 * a shim on `PATH` that writes its arguments down, so what the update asked
 * git is counted, not timed.
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

  async function tell(told: { roots?: string[]; clock?: string; fresh?: boolean; files?: unknown[] }): Promise<void> {
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

    const real = execFileSync('sh', ['-c', 'command -v git'], { encoding: 'utf8' }).trim();
    const bin = join(wire, 'bin');
    await mkdir(bin);
    await writeFile(join(bin, 'git'), `#!/bin/sh\necho "$*" >> '${asked()}'\nexec '${real}' "$@"\n`);
    await chmod(join(bin, 'git'), 0o755);

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
    const second = await updateNatively(root, index);
    expect(await gitRan()).toEqual([]);
    expect(second).toMatchObject({ files: first!.files, reread: 0 });
    expect(second!.listing.paths()).toEqual(first!.listing.paths());
  });

  it('asks git when Watchman starts over, and when the clock names a file the generation holds', async () => {
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
