import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { chromium } from 'playwright';
import { describe, expect, it } from 'vitest';

/**
 * Baselines in git-LFS, put through a real git-lfs.
 *
 * Every test of the LFS store in `packages/store` drives git through an injected
 * runner, and every pointer there is a string literal nobody's clean filter
 * produced. This file runs the commands a consumer runs — `variance run`,
 * `accept`, `git commit`, `git push`, `git clone` with and without the smudge —
 * against a bare repository standing in for the remote, and asserts what the
 * consumer would see:
 *
 * 1. a clone made where git-lfs is not installed is refused by name, at the
 *    subject,
 * 2. with exit 2, because the run did not happen,
 * 3. `variance doctor`, and `doctor --baselines` with no browser, say so before
 *    any run,
 * 4. and the image that comes back through `git lfs pull` is the one committed.
 *
 * The unsmudged clone is made with git-lfs absent rather than told to skip: a
 * `PATH` on which no `git-lfs` resolves and a git configuration with no LFS
 * filter in it, which is the machine a consumer's CI is when nobody installed
 * git-lfs there.
 *
 * Where the baseline sits is asked of git (`git lfs ls-files`), never spelled
 * here: the layout is the store's to decide.
 *
 * Skipped, loudly, without a browser or without git-lfs. A job that installs
 * git-lfs sets `VARIANCE_REQUIRE_GIT_LFS=1`, and then a missing git-lfs fails.
 */

const consumer = fileURLToPath(new URL('../consumer/', import.meta.url));
const bin = fileURLToPath(new URL('../../../packages/cli/dist/bin.js', import.meta.url));

const POINTER = 'version https://git-lfs.github.com/spec/v1';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const BROWSER_AVAILABLE = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();
const GIT_LFS_AVAILABLE = spawnSync('git', ['lfs', 'version']).status === 0;
const GIT_LFS_REQUIRED = process.env.VARIANCE_REQUIRE_GIT_LFS === '1';

const live = BROWSER_AVAILABLE && (GIT_LFS_AVAILABLE || GIT_LFS_REQUIRED) ? describe : describe.skip;

if (!BROWSER_AVAILABLE) {
  console.warn('\ncases/git-lfs-case: skipped.\n  no browser — npx playwright install chromium\n');
} else if (!GIT_LFS_AVAILABLE && !GIT_LFS_REQUIRED) {
  console.warn(
    '\ncases/git-lfs-case: skipped.\n  no git-lfs — brew install git-lfs, or apt-get install git-lfs\n',
  );
}

live('baselines committed through git-LFS', () => {
  it('are refused as pointers on a clone made without git-lfs, seen by doctor, and come back byte for byte', async () => {
    if (!GIT_LFS_AVAILABLE) {
      throw new Error('VARIANCE_REQUIRE_GIT_LFS=1 is set and `git lfs version` does not run on this machine');
    }

    const scratch = await mkdtemp(join(tmpdir(), 'variance-git-lfs-case-'));
    try {
      // Git's configuration is this test's own: the filter `git lfs install`
      // registers goes into a file under the scratch directory, never into the
      // machine's, and no system file decides anything.
      const env = {
        ...process.env,
        GIT_CONFIG_GLOBAL: join(scratch, 'gitconfig'),
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_AUTHOR_NAME: 'git-lfs case',
        GIT_AUTHOR_EMAIL: 'case@variance-authority.invalid',
        GIT_COMMITTER_NAME: 'git-lfs case',
        GIT_COMMITTER_EMAIL: 'case@variance-authority.invalid',
      };
      // Set only where this test means to skip the smudge, never inherited.
      delete env.GIT_LFS_SKIP_SMUDGE;
      const run = (cwd, command, args, extra = {}) => {
        const result = spawnSync(command, args, { cwd, env: { ...env, ...extra }, encoding: 'utf8' });
        if (result.error !== undefined) throw result.error;
        return { code: result.status, output: `${result.stdout}${result.stderr}` };
      };
      const git = (cwd, ...args) => {
        const result = run(cwd, 'git', args);
        expect(result.code, `git ${args.join(' ')}\n${result.output}`).toBe(0);
        return result.output;
      };
      // A cache per clone, so each clone is a machine of its own and nothing one
      // of them rendered answers for another.
      const variance = (cwd, ...args) =>
        run(cwd, process.execPath, [bin, ...args], { VARIANCE_AUTHORITY_CACHE: join(cwd, '.cache') });

      git(scratch, 'lfs', 'install', '--skip-repo');
      git(scratch, 'config', '--global', 'init.defaultBranch', 'main');

      // A machine with git and no git-lfs. Every `PATH` directory that holds a
      // `git-lfs` is replaced, in its place, by a directory of links to
      // everything else in it, and git's configuration is a file `git lfs
      // install` never wrote to.
      const withoutLfs = join(scratch, 'without-lfs');
      const dirs = (process.env.PATH ?? '').split(delimiter).filter(Boolean);
      const path = [];
      for (const [index, dir] of dirs.entries()) {
        if (!existsSync(join(dir, 'git-lfs'))) {
          path.push(dir);
          continue;
        }
        const mirror = join(withoutLfs, String(index));
        await mkdir(mirror, { recursive: true });
        for (const entry of await readdir(dir)) {
          if (entry !== 'git-lfs') await symlink(join(dir, entry), join(mirror, entry));
        }
        path.push(mirror);
      }
      const noLfs = { PATH: path.join(delimiter), GIT_CONFIG_GLOBAL: join(withoutLfs, 'gitconfig') };
      await writeFile(noLfs.GIT_CONFIG_GLOBAL, '[init]\n\tdefaultBranch = main\n');
      const absent = run(scratch, 'git', ['lfs', 'version'], noLfs);
      expect(absent.code, `git lfs version still runs without git-lfs\n${absent.output}`).not.toBe(0);

      const origin = join(scratch, 'origin.git');
      const work = join(scratch, 'work');
      git(scratch, 'init', '--quiet', '--bare', origin);
      // A `file://` URL rather than a path: git-lfs moves objects to a local remote
      // only through its standalone transfer agent, which a bare path does not select.
      const remote = pathToFileURL(origin).href;
      git(scratch, 'init', '--quiet', work);
      await copyFile(join(consumer, 'collector.mjs'), join(work, 'collector.mjs'));
      await copyFile(join(consumer, 'variance.config.json'), join(work, 'variance.config.json'));
      await writeFile(join(work, 'swatch.txt'), 'rgb(30, 120, 200)\n');
      await writeFile(join(work, '.gitignore'), '.variance/\n.cache/\n');

      // Recorded and accepted the way the README's first loop does it.
      const first = variance(work, 'run', '--exit-zero-on-changes');
      expect(first.code, first.output).toBe(0);
      const accepted = variance(work, 'accept', '--all');
      expect(accepted.code, accepted.output).toBe(0);

      git(work, 'add', '-A');
      git(work, 'commit', '--quiet', '-m', 'baseline');
      git(work, 'push', '--quiet', remote, 'HEAD:main');

      // The images git-lfs took, by git-lfs's own account: how many files the
      // store writes per subject is the store's to decide.
      const tracked = git(work, 'lfs', 'ls-files', '-n').trim().split('\n').filter(Boolean);
      expect(tracked.length).toBeGreaterThan(0);
      const committed = new Map();
      for (const baseline of tracked) {
        // A pointer in the object database, an image in the working tree.
        expect(git(work, 'cat-file', '-p', `HEAD:${baseline}`).startsWith(`${POINTER}\n`)).toBe(true);
        const bytes = await readFile(join(work, baseline));
        expect(bytes.subarray(0, PNG.length)).toEqual(PNG);
        committed.set(baseline, bytes);
      }
      const holds = async (clone) => {
        for (const [baseline, bytes] of committed) {
          expect(Buffer.compare(await readFile(join(clone, baseline)), bytes), baseline).toBe(0);
        }
      };

      // 4. A clone with git-lfs smudges the bytes that went in.
      const smudged = join(scratch, 'smudged');
      git(scratch, 'clone', '--quiet', remote, smudged);
      await holds(smudged);

      // A clone made without git-lfs holds the pointer text where each image was.
      const unsmudged = join(scratch, 'unsmudged');
      const cloned = run(scratch, 'git', ['clone', '--quiet', remote, unsmudged], noLfs);
      expect(cloned.code, cloned.output).toBe(0);
      for (const baseline of tracked) {
        expect((await readFile(join(unsmudged, baseline), 'utf8')).startsWith(POINTER), baseline).toBe(true);
      }
      const varianceWithoutLfs = (...args) =>
        run(unsmudged, process.execPath, [bin, ...args], {
          ...noLfs,
          VARIANCE_AUTHORITY_CACHE: join(unsmudged, '.cache'),
        });
      const named = (output) => tracked.some((baseline) => output.includes(baseline.split('/').at(-1)));

      // 3. Doctor sees it before any run does, and exits as the run would;
      // `--baselines` asks the store alone, which is what the action asks
      // before every run.
      const doctor = varianceWithoutLfs('doctor');
      expect(doctor.code, doctor.output).toBe(2);
      expect(doctor.output).toContain('POINTERS, NOT IMAGES');
      expect(named(doctor.output), doctor.output).toBe(true);
      expect(doctor.output).toContain('git lfs install && git lfs pull');
      const store = varianceWithoutLfs('doctor', '--baselines');
      expect(store.code, store.output).toBe(2);
      expect(store.output).toContain('POINTERS, NOT IMAGES');

      // The run alone settles a subject whose document did not move from its
      // record, without opening the image, so it is green here. That is why the
      // action asks `doctor --baselines` before it runs.
      const unchanged = varianceWithoutLfs('run');
      expect(unchanged.code, unchanged.output).toBe(0);

      // 1 and 2. The subject whose document moved meets the pointer, by name.
      await writeFile(join(unsmudged, 'swatch.txt'), 'rgb(200, 60, 30)\n');
      const refused = varianceWithoutLfs('run');
      expect(refused.code, refused.output).toBe(2);
      expect(refused.output).toContain('the baseline for `swatch` is a git-LFS pointer, not an image');

      // Once git-lfs is there and the images are fetched, the same edit is a
      // change to review, not a refusal.
      git(unsmudged, 'lfs', 'pull');
      await holds(unsmudged);
      const changed = variance(unsmudged, 'run');
      expect(changed.code, changed.output).toBe(1);
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 180_000);
});
