import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core';
import { identityDigest } from '@variance-authority/core';
import { createLfsStore, type CommandResult, type CommandRunner } from './store-lfs.js';

/**
 * Baselines in the repository, and the three things that can quietly go wrong.
 *
 * The bytes have to survive a round trip; the identity partition has to survive
 * being wrapped; and the tracking has to be *established* rather than assumed,
 * because a `.gitattributes` that was never written and a `.gitattributes` that
 * is overridden from above look identical from inside this package. Every test
 * that consults git does so through an injected runner: the failure worth
 * covering is a machine without git, and a suite that can only be run on a
 * machine with git cannot cover it.
 */

const MAC: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'darwin/arm64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/abc'],
};

/** Same browser, different machine. The case the partition exists for. */
const RUNNER: RenderIdentity = { ...MAC, platform: 'linux/x64' };

const ENTRY = '*.png filter=lfs diff=lfs merge=lfs -text';

function rasterOf(identity: RenderIdentity, bytes = 'QUJD'): Raster {
  return { documentDigest: 'v1:doc', identity, width: 10, height: 10, bytes, missingFonts: [] };
}

/** A git that reports the glob as tracked, without a git being present. */
function gitReporting(filter: string, lfsInstalled = true): CommandRunner {
  return async (command, args): Promise<CommandResult> => {
    if (command !== 'git') throw new Error(`unexpected command ${command}`);
    if (args[1] === 'version') return { code: lfsInstalled ? 0 : 1, stdout: '', stderr: '' };
    return { code: 0, stdout: `probe.png: filter: ${filter}\n`, stderr: '' };
  };
}

const TRACKED = gitReporting('lfs');

const hasGit = spawnSync('git', ['--version']).status === 0;

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-lfs-'));
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('a baseline store in the repository', () => {
  it('round-trips a baseline through ordinary files, with no git in the path', async () => {
    // LFS is a clean/smudge filter, so a checked-out tree already holds the PNG.
    // Reading it back through git would be a second way to obtain the same bytes,
    // and therefore a way for the two to disagree.
    const store = await createLfsStore({ root, git: TRACKED });
    await store.put({ subject: 'todo--empty' }, rasterOf(MAC, 'QUJD'));

    const found = await store.find({ subject: 'todo--empty' }, MAC);

    expect(found?.comparable).toBe(true);
    expect(found?.raster.bytes).toBe('QUJD');
    // At the durable layout's path, not somewhere of this store's own devising.
    const path = join(root, identityDigest(MAC), 'todo--empty.png');
    expect((await stat(path)).isFile()).toBe(true);
  });

  it('never runs git to read or write an image', async () => {
    // The rule the previous test can only imply. LFS is a clean/smudge filter, so
    // the bytes are already at the path; a `git show` in the read path would be a
    // second source for the same image and a process per lookup. git is asked one
    // question, once, and it is not about content.
    const calls: string[] = [];
    const counted: CommandRunner = async (command, args) => {
      calls.push([command, ...args].join(' '));
      return TRACKED(command, args, { cwd: root });
    };

    const store = await createLfsStore({ root, git: counted });
    const during = calls.length;

    await store.put({ subject: 's' }, rasterOf(MAC));
    await store.find({ subject: 's' }, MAC);
    await store.describe({ subject: 's' }, MAC);
    await store.cache(rasterOf(MAC));
    await store.cached('v1:doc', MAC);

    expect(calls).toEqual(['git check-attr filter -- probe.png', 'git lfs version']);
    expect(calls.length).toBe(during);
  });

  it('does not let one machine reach another machine`s baseline', async () => {
    // The partition is delegated rather than reimplemented, and this is the test
    // that says so: wrapping the durable store must not have loosened it.
    const store = await createLfsStore({ root, git: TRACKED });
    await store.put({ subject: 'todo--empty' }, rasterOf(RUNNER));

    const found = await store.find({ subject: 'todo--empty' }, MAC);

    expect(found).not.toBeNull();
    expect(found?.comparable).toBe(false);
    expect(found?.storedUnder.platform).toBe('linux/x64');
  });

  it('writes the tracking entry before any image exists', async () => {
    // On first `put` would be too late: a run that writes three hundred PNGs and
    // dies before committing has already made the mess the entry prevents, and
    // adding the line afterwards does not convert them.
    const store = await createLfsStore({ root, git: TRACKED });

    expect(store.tracking.added).toBe(true);
    expect(await readFile(join(root, '.gitattributes'), 'utf8')).toBe(`${ENTRY}\n`);
  });

  it('adds the entry once however often the store is opened', async () => {
    // A line appended per run turns a two-line file into a run log.
    await createLfsStore({ root, git: TRACKED });
    const second = await createLfsStore({ root, git: TRACKED });

    expect(second.tracking.added).toBe(false);
    expect(await readFile(join(root, '.gitattributes'), 'utf8')).toBe(`${ENTRY}\n`);
  });

  it('leaves an entry it did not write exactly as written, and reports it', async () => {
    // `.gitattributes` is a file people write by hand and other tools read.
    // Rewriting someone's entry into this package's preferred form would change
    // how git treats paths this package knows nothing about.
    await writeFile(join(root, '.gitattributes'), '*.png text\n', 'utf8');

    const store = await createLfsStore({ root, git: TRACKED });

    expect(await readFile(join(root, '.gitattributes'), 'utf8')).toBe('*.png text\n');
    expect(store.tracking.added).toBe(false);
    expect(store.tracking.diagnostics.join('\n')).toMatch(/does not route it through LFS/);
  });

  it('appends without disturbing entries that were already there', async () => {
    await writeFile(join(root, '.gitattributes'), '# ours\n*.md text\n', 'utf8');

    await createLfsStore({ root, git: TRACKED });

    expect(await readFile(join(root, '.gitattributes'), 'utf8')).toBe(
      `# ours\n*.md text\n${ENTRY}\n`,
    );
  });

  it('does not read a commented-out entry as an existing one', async () => {
    // A commented line is a note about the file, not an instruction to git, and
    // treating it as one would leave the glob untracked with nothing said.
    await writeFile(join(root, '.gitattributes'), `# ${ENTRY}\n`, 'utf8');

    const store = await createLfsStore({ root, git: TRACKED });

    expect(store.tracking.added).toBe(true);
    expect(await readFile(join(root, '.gitattributes'), 'utf8')).toBe(`# ${ENTRY}\n${ENTRY}\n`);
  });
});

describe('a machine that cannot be asked about tracking', () => {
  it('keeps working without git, and says what is now unknown', async () => {
    // Degrading rather than failing: the directory is readable and writable
    // without git, so refusing to run would trade a working capability for a
    // warning. What is lost is the confirmation, and that is what gets reported.
    const absent: CommandRunner = () => Promise.reject(new Error('spawn git ENOENT'));

    const store = await createLfsStore({ root, git: absent });
    await store.put({ subject: 's' }, rasterOf(MAC, 'QQ=='));

    expect((await store.find({ subject: 's' }, MAC))?.raster.bytes).toBe('QQ==');
    expect(store.tracking.filter).toBeNull();
    expect(store.tracking.diagnostics.join('\n')).toMatch(/git could not be run/);
  });

  it('reports a directory outside a work tree instead of claiming it is tracked', async () => {
    const notARepo: CommandRunner = async () => ({
      code: 128,
      stdout: '',
      stderr: 'fatal: not a git repository (or any of the parent directories): .git\n',
    });

    const store = await createLfsStore({ root, git: notARepo });

    expect(store.tracking.filter).toBeNull();
    expect(store.tracking.diagnostics.join('\n')).toMatch(/not a git repository/);
  });

  it('reports a glob git does not route through LFS, entry or no entry', async () => {
    // An entry can be present and overridden by a `.gitattributes` above it. What
    // matters is what git resolves, which is why the check asks git rather than
    // reading back the file this package just wrote.
    const store = await createLfsStore({ root, git: gitReporting('unspecified') });

    expect(store.tracking.filter).toBe('unspecified');
    expect(store.tracking.diagnostics.join('\n')).toMatch(/not `lfs`/);
  });

  it('reports a configured filter with nothing installed to implement it', async () => {
    // The quiet one: commits succeed, nothing warns, and whole PNGs go into the
    // object database until the repository is unclonable.
    const store = await createLfsStore({ root, git: gitReporting('lfs', false) });

    expect(store.tracking.filter).toBe('lfs');
    expect(store.tracking.diagnostics.join('\n')).toMatch(/git-lfs is not installed/);
  });

  it('states that it did not check when it was told not to', async () => {
    const store = await createLfsStore({ root, verify: false, git: TRACKED });

    expect(store.tracking.diagnostics.join('\n')).toMatch(/was not verified/);
  });
});

describe('a clone without git-lfs', () => {
  it('refuses an unsmudged pointer instead of reporting a missing baseline', async () => {
    // Without git-lfs the working tree holds 130 bytes of pointer text where the
    // PNG should be. Reporting that as absent makes the verdict `new`, `new`
    // re-records what is on screen, and the baseline it overwrites was the only
    // copy of what the subject looked like before.
    const store = await createLfsStore({ root, git: TRACKED });
    await store.put({ subject: 'todo--empty' }, rasterOf(MAC));

    const pointer =
      'version https://git-lfs.github.com/spec/v1\n' +
      'oid sha256:4d7a2145b0d3f1e2c4a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7\nsize 1024\n';
    await writeFile(join(root, identityDigest(MAC), 'todo--empty.png'), pointer, 'utf8');

    await expect(store.find({ subject: 'todo--empty' }, MAC)).rejects.toThrow(
      /git-LFS pointer, not an image/,
    );
  });

  it('still describes a baseline from its sidecar, which a pointer cannot corrupt', async () => {
    // The stated limit of the cheap lookup, pinned so it is a decision rather than
    // an oversight. Sidecars are outside the tracked glob, so they are real text on
    // every clone: "the document this run assembled is the one that baseline was
    // painted from" is a fact about two committed text files and stays true where
    // the PNG is 130 bytes of pointer. The moment the bytes are needed — the
    // document moved, something must be compared — `find` runs and refuses.
    const store = await createLfsStore({ root, git: TRACKED });
    await store.put({ subject: 'todo--empty' }, rasterOf(MAC));
    await writeFile(
      join(root, identityDigest(MAC), 'todo--empty.png'),
      'version https://git-lfs.github.com/spec/v1\noid sha256:4d7a\nsize 1024\n',
      'utf8',
    );

    expect(await store.describe({ subject: 'todo--empty' }, MAC)).toEqual({
      documentDigest: 'v1:doc',
      comparable: true,
      storedUnder: MAC,
    });
    await expect(store.find({ subject: 'todo--empty' }, MAC)).rejects.toThrow(
      /git-LFS pointer, not an image/,
    );
  });

  it('passes any other bytes through, so it is no stricter than the store it wraps', async () => {
    // A store that acquired its own idea of what a raster may contain would make
    // "switching implementations changes no verdict" false for reasons unrelated
    // to storage.
    const store = await createLfsStore({ root, git: TRACKED });
    await store.put({ subject: 's' }, rasterOf(MAC, 'AAAA'));

    expect((await store.find({ subject: 's' }, MAC))?.raster.bytes).toBe('AAAA');
  });
});

describe('against a real git', () => {
  // Skipped where git is absent, and the skip is stated rather than silent: the
  // injected runners above pin the *reactions*, and only a real repository can
  // show that `git check-attr filter -- probe.png` is the right question asked
  // the right way.
  it.skipIf(!hasGit)('resolves the written entry to the lfs filter', async () => {
    expect(spawnSync('git', ['init', '--quiet', root]).status).toBe(0);

    const store = await createLfsStore({ root });

    expect(store.tracking.added).toBe(true);
    expect(store.tracking.filter).toBe('lfs');
  });
});
