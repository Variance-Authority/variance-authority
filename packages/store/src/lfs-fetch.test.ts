import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import { digestFileName, identityDigest } from '@variance-authority/core/format';
import { RasterStoreError } from '@variance-authority/raster';
import { createLfsStore, type CommandResult, type CommandRunner } from './lfs.js';

/**
 * A clone that skipped the smudge, and the images a run actually compares.
 *
 * An LFS checkout made with `GIT_LFS_SKIP_SMUDGE=1` holds a pointer at every
 * baseline's path. Most of a run never needs the image behind one: `describe`
 * settles every subject whose document did not move from the sidecar alone. So
 * the store fetches an image when `find` meets its pointer, and only then — a
 * run downloads the baselines of the subjects that changed, not the repository's
 * history of every picture.
 */

const MAC: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/abc'],
};

/** A PNG signature and a byte, which is all a store ever looks at. */
const IMAGE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x01]).toString('base64');

const POINTER =
  'version https://git-lfs.github.com/spec/v1\n' +
  'oid sha256:4d7a2145b0d3f1e2c4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7\nsize 9\n';

const OK: CommandResult = { code: 0, stdout: '', stderr: '' };

const partition = digestFileName(identityDigest(MAC));

function rasterOf(bytes = IMAGE): Raster {
  return { documentDigest: 'v1:doc', identity: MAC, width: 1, height: 1, bytes, missingFonts: [] };
}

/**
 * git in front of a clone that skipped the smudge: tracked, and every image a
 * pointer until `git lfs pull` names it.
 *
 * `hold` keeps a pull running until the test lets it finish, which is the only
 * way to see what queues behind it.
 */
function skippedSmudge(options: { hold?: Promise<void>; pull?: CommandResult } = {}): {
  git: CommandRunner;
  calls: string[];
  pulls: string[][];
} {
  const calls: string[] = [];
  const pulls: string[][] = [];
  const git: CommandRunner = async (command, args) => {
    calls.push([command, ...args].join(' '));
    if (args[0] === 'check-attr') return { ...OK, stdout: 'probe.png: filter: lfs\n' };
    if (args[0] === 'rev-parse') return { ...OK, stdout: `${await realpath(root)}\n` };
    if (args[0] === 'config') return { ...OK, stdout: 'git-lfs clean -- %f\n' };
    if (args[0] === 'lfs' && args[1] === 'pull') {
      const included = (args[2] ?? '').replace(/^--include=/, '').split(',');
      pulls.push(included);
      await options.hold;
      if (options.pull !== undefined) return options.pull;
      for (const path of included) await writeFile(join(root, path), Buffer.from(IMAGE, 'base64'));
      return OK;
    }
    return OK;
  };
  return { git, calls, pulls };
}

/** Baselines for these subjects, each with a pointer where its image was. */
async function pointersFor(subjects: readonly string[]): Promise<void> {
  const writer = await createLfsStore({ root, verify: false });
  for (const subject of subjects) {
    await writer.put({ subject }, rasterOf());
    await writeFile(join(root, partition, `${subject}.png`), POINTER, 'utf8');
  }
}

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-lfs-fetch-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('a clone that skipped the smudge', () => {
  it('fetches the image of the one subject it compares, and no other', async () => {
    await pointersFor(['todo--empty', 'todo--full']);
    const { git, pulls } = skippedSmudge();
    const store = await createLfsStore({ root, git });

    const found = await store.find({ subject: 'todo--empty' }, MAC);

    expect(found?.raster.bytes).toBe(IMAGE);
    expect(pulls).toEqual([[`${partition}/todo--empty.png`]]);
    expect(await readFile(join(root, partition, 'todo--full.png'), 'utf8')).toBe(POINTER);
  });

  it('settles from the sidecar without fetching anything', async () => {
    // The whole saving. A subject whose document did not move is answered by
    // `describe`, and `describe` never needed the pixels.
    await pointersFor(['todo--empty']);
    const { git, calls } = skippedSmudge();
    const store = await createLfsStore({ root, git });
    const opened = calls.length;

    expect((await store.describe({ subject: 'todo--empty' }, MAC))?.documentDigest).toBe('v1:doc');
    expect(calls.length).toBe(opened);
  });

  it('asks for every pointer met during a pull in the one pull after it', async () => {
    // Lanes run concurrently. A pull per subject is a process and a round trip
    // to the LFS server each; a pull that waits to collect more has to guess how
    // long to wait. Neither: the first pointer starts a pull, and every pointer
    // met while it runs goes into the next one.
    await pointersFor(['a', 'b', 'c']);
    let release = (): void => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { git, pulls } = skippedSmudge({ hold });
    const store = await createLfsStore({ root, git });

    const first = store.find({ subject: 'a' }, MAC);
    await until(() => pulls.length === 1);
    const rest = [store.find({ subject: 'b' }, MAC), store.find({ subject: 'c' }, MAC)];
    // Time for both lookups to read their pointers and queue. Nothing outside the
    // store can see the queue, and a pull released early splits the batch, which
    // fails the assertion rather than passing it.
    await new Promise((resolve) => setTimeout(resolve, 250));
    release();

    for (const found of await Promise.all([first, ...rest])) expect(found?.raster.bytes).toBe(IMAGE);
    // Within a batch, the order is whichever read finished first.
    expect(pulls.map((pull) => [...pull].sort())).toEqual([
      [`${partition}/a.png`],
      [`${partition}/b.png`, `${partition}/c.png`],
    ]);
  });

  it('splits a batch too long for one command line into consecutive pulls', async () => {
    // A run where every subject moved meets every pointer at once.
    const names = Array.from({ length: 150 }, (_, i) => `${String(i).padStart(3, '0')}--${'x'.repeat(100)}`);
    await pointersFor(['a', ...names]);
    let release = (): void => undefined;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { git, calls, pulls } = skippedSmudge({ hold });
    const store = await createLfsStore({ root, git });

    const first = store.find({ subject: 'a' }, MAC);
    await until(() => pulls.length === 1);
    const rest = names.map((subject) => store.find({ subject }, MAC));
    await new Promise((resolve) => setTimeout(resolve, 250));
    release();
    await Promise.all([first, ...rest]);

    const includes = calls.filter((call) => call.startsWith('git lfs pull')).slice(1);
    expect(includes.length).toBeGreaterThan(1);
    for (const call of includes) expect(call.length).toBeLessThan(8100);
    expect(pulls.slice(1).flat().sort()).toEqual(names.map((name) => `${partition}/${name}.png`));
  });

  it('refuses, naming the pull, when git-lfs could not fetch the image', async () => {
    // Never a miss: a pointer read as absent is `new`, and `new` re-records
    // whatever is on screen over the baseline nobody could download.
    await pointersFor(['todo--empty']);
    const { git } = skippedSmudge({
      pull: { code: 2, stdout: '', stderr: 'batch response: Repository or object not found\n' },
    });
    const store = await createLfsStore({ root, git });

    const lookup = store.find({ subject: 'todo--empty' }, MAC);

    await expect(lookup).rejects.toBeInstanceOf(RasterStoreError);
    await expect(lookup).rejects.toThrow(/git lfs pull.*exited 2.*Repository or object not found/s);
    // Said once: the read around the fetch lets a refusal through as it is.
    await expect(lookup).rejects.not.toThrow(/could not read/);
  });

  it('refuses, naming the remedy, when the pull leaves the pointer where it was', async () => {
    // git-lfs installed and never set up in the repository: `git lfs pull`
    // downloads the object, says it is skipping the checkout, and exits 0.
    await pointersFor(['todo--empty']);
    const { git } = skippedSmudge({ pull: OK });
    const store = await createLfsStore({ root, git });

    await expect(store.find({ subject: 'todo--empty' }, MAC)).rejects.toThrow(
      /still a git-LFS pointer.*git lfs install --local/s,
    );
  });

  it('fetches nothing when it was told not to consult git', async () => {
    await pointersFor(['todo--empty']);
    const { git, calls } = skippedSmudge();
    const store = await createLfsStore({ root, git, verify: false });

    await expect(store.find({ subject: 'todo--empty' }, MAC)).rejects.toThrow(
      /git-LFS pointer, not an image/,
    );
    expect(calls).toEqual([]);
  });
});

const hasLfs = spawnSync('git', ['lfs', 'version']).status === 0;

describe('against a real git with git-lfs', () => {
  // Skipped where git-lfs is absent, for the reason the `hasGit` skip in
  // `lfs.test.ts` gives: the injected runners above pin the reactions, and only
  // a real repository shows that the path handed to `--include` is the path git
  // matches, through the escaping a bracketed directory needs.
  it.skipIf(!hasLfs)(
    'commits pointers, clones without the smudge, and fetches back the bytes that went in',
    async () => {
      const origin = join(root, 'origin.git');
      const work = join(root, 'work');
      const clone = join(root, 'clone');
      git(root, 'init', '--quiet', '--bare', origin);
      git(root, 'clone', '--quiet', origin, work);
      git(work, 'lfs', 'install', '--local');

      // `beside`, under a directory named the way a route segment is: `[` is a
      // glob character to `--include`, and an unescaped one matches nothing. A
      // `!` inside a name is the opposite: escaped, it matches nothing.
      const baselines = join(work, 'app', '[slug]', 'a!b');
      await mkdir(baselines, { recursive: true });
      const writer = await createLfsStore({ root: baselines, layout: 'beside' });
      expect(writer.tracking.diagnostics).toEqual([]);
      await writer.put({ subject: 'page--empty' }, rasterOf());
      await writer.put({ subject: 'page--full' }, rasterOf());
      git(work, 'add', '.');
      git(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'baselines');
      git(work, 'push', '--quiet', 'origin', 'HEAD');

      // The committed image is a pointer in the object database.
      const tracked = `app/[slug]/a!b/${partition}/page--empty.png`;
      expect(git(work, 'show', `HEAD:${tracked}`)).toMatch(/^version https:\/\/git-lfs/);

      git(root, 'clone', '--quiet', origin, clone, { GIT_LFS_SKIP_SMUDGE: '1' });
      git(clone, 'lfs', 'install', '--local', '--skip-smudge');
      expect(await readFile(join(clone, tracked), 'utf8')).toMatch(/^version https:\/\/git-lfs/);

      const reader = await createLfsStore({ root: join(clone, 'app', '[slug]', 'a!b'), layout: 'beside' });
      expect(reader.tracking.diagnostics).toEqual([]);
      const found = await reader.find({ subject: 'page--empty' }, MAC);

      expect(found?.raster.bytes).toBe(IMAGE);
      expect(
        await readFile(join(clone, `app/[slug]/a!b/${partition}/page--full.png`), 'utf8'),
      ).toMatch(/^version https:\/\/git-lfs/);
      expect(git(clone, 'status', '--porcelain')).toBe('');
    },
  );
});

function git(cwd: string, ...args: (string | Record<string, string>)[]): string {
  const last = args.at(-1);
  const env = typeof last === 'object' ? last : {};
  const argv = args.filter((arg): arg is string => typeof arg === 'string');
  const result = spawnSync('git', argv, { cwd, encoding: 'utf8', env: { ...process.env, ...env } });
  if (result.status !== 0) throw new Error(`git ${argv.join(' ')}: ${result.stderr}`);
  return result.stdout.trim();
}

/** Yield to the event loop until the condition holds: the lookups read files first. */
async function until(condition: () => boolean | Promise<boolean>): Promise<void> {
  for (let turn = 0; turn < 1000; turn += 1) {
    if (await condition()) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('the condition never held');
}
