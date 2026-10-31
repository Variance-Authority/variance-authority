import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import type { Raster } from '@variance-authority/core/format';
import { neverFails } from '@variance-authority/raster';
import type { Described, Found, RasterStore } from '@variance-authority/raster';
import { createDurableStore, DEFAULT_BASELINE_PATH, parseBaselinePath, type DurableStoreOptions } from './durable.js';
import { attributesPattern, ensureEntry } from './lfs-attributes.js';
import { fetchingReader } from './lfs-fetch.js';
import { refuseAPointer } from './lfs-pointer.js';
import { checkTracking } from './lfs-tracking.js';

/**
 * Baselines in the repository, tracked by git-LFS.
 *
 * The default durable backend, and the argument for it is operational rather
 * than technical: it needs no service, no bucket, no credentials, and no second
 * thing to keep running, so the cost of turning durable mode on is one line in
 * `.gitattributes`. The usual objection to committing derived state — that it
 * puts a machine-produced artifact under human merge resolution (spec 0002) —
 * does not reach an image. A baseline is never *merged*; a conflict is settled
 * by taking one side, which is a decision a person makes in seconds and cannot
 * get subtly half-right. That is precisely the property a *record* of hashes
 * lacks, which is why the record is a service and the images are files.
 *
 * **The bytes are ordinary files.** Nothing here reads or writes an image
 * through git. LFS is a clean/smudge filter, so a checked-out working tree
 * already holds the real PNG at the real path; routing reads through `git show`
 * would add a second way to obtain the same bytes, and therefore a way for the
 * two to disagree. `git` is consulted for two things. At open, whether the glob
 * is genuinely routed through the filter — and its absence degrades to a
 * diagnostic rather than to a failed run, because a machine without git can
 * still read and write this directory perfectly well and refusing to run there
 * would trade a working capability for a warning. And when `find` meets a
 * pointer, `git lfs pull --include` checks that one file out, so a clone that
 * skipped the smudge downloads the images it compares and no others
 * (ADR-0092). git-lfs writes the file; the store reads it, as before.
 *
 * **Placement is not reimplemented.** Every path decision is delegated to
 * {@link createDurableStore}, so `baselines.path` is rendered in one place. A
 * second copy would be a second chance to place a baseline where the first copy
 * does not look for it.
 *
 * **What LFS adds that a plain directory does not have: a pointer.** On a clone
 * that skipped the smudge, the working tree holds a short text file where the
 * PNG should be. It is fetched; where it cannot be — no git-lfs, `verify:
 * false`, a failed pull — reporting it as a baseline would compare a subject
 * against a text file, so it is refused by name.
 */


export { lfsSetup } from './lfs-tracking.js';

export interface CommandResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Runs a command and reports how it went.
 *
 * Resolves for a process that *ran*, whatever it then said; rejects only when the
 * binary could not be executed at all. The distinction carries the whole
 * degradation rule: git answering "not a git repository" is information about
 * this directory, and git not existing is a different sentence about this
 * machine. Collapsing them would report a missing tool as an untracked glob.
 *
 * Injectable so the git-absent path is testable without uninstalling git.
 */
export type CommandRunner = (
  command: string,
  args: readonly string[],
  options: { readonly cwd: string },
) => Promise<CommandResult>;

/**
 * Everything the durable store places by, and the four things git adds.
 *
 * The placement keys — `path`, `cacheRoot`, `recordRoot` — are inherited
 * rather than restated: this store *is* the durable one with a filter in front,
 * and two copies of that vocabulary are two things to keep in step. Each means
 * here exactly what it means there, with one addition each. `path` also decides
 * the default `pattern`, so the entry tracks the images the template renders and
 * no other image in the tree. And `recordRoot` matters more here than anywhere else:
 * `pattern` routes the images out of the object database, and the records are
 * the text left behind to go on growing it.
 */
export interface LfsStoreOptions extends Omit<DurableStoreOptions, 'readImage'> {
  /** Baseline root, laid out exactly as the durable store lays it out. */
  readonly root: string;

  /**
   * Glob for the tracked images, relative to the `.gitattributes` that holds it.
   *
   * Defaults to the template's glob with `.webp` on the end — `*-*.webp` for the
   * default `{title}/{name}-{engine}`, matching at every depth. Under a root that
   * is the repository itself that also takes any other WebP with a `-` in its
   * name, so the CLI's config refuses the pair unless the template names a
   * directory of its own (`BaselinePathTemplate.anchored`) or this is set. Images
   * only: the `.json` sidecars stay reviewable text.
   */
  readonly pattern?: string;

  /**
   * Where the tracking entry lives. Defaults to `<root>/.gitattributes`.
   *
   * In the baseline root rather than the repository root because attributes apply
   * to the directory that holds the file and everything under it, which is
   * exactly the scope of this store. Writing to the repository root would take a
   * shared file hostage to a subdirectory's needs.
   */
  readonly attributesFile?: string;

  /** `false` skips consulting git entirely, and says so in the diagnostics. */
  readonly verify?: boolean;

  readonly git?: CommandRunner;
}

/**
 * What is known about the tracking, including what could not be established.
 *
 * A store that quietly decided it could not check would leave the operator
 * believing images are pointers when they are whole PNGs in the object database —
 * a repository that is fine until it is 4 GB. So the uncertainty is a value the
 * caller can print.
 */
export interface LfsTracking {
  readonly attributesFile: string;
  readonly pattern: string;
  /** `true` when this call appended the entry; `false` when one already existed. */
  readonly added: boolean;
  /**
   * What git resolves the `filter` attribute to for a matching path — `lfs` when
   * tracking is real — or `null` when git could not be asked at all.
   */
  readonly filter: string | null;
  /** Everything that could not be verified or was found wrong. Empty means checked. */
  readonly diagnostics: readonly string[];
}

export interface LfsStore extends RasterStore {
  readonly tracking: LfsTracking;
}

/**
 * A durable store whose directory is a tracked part of the repository.
 *
 * Asynchronous because the tracking entry is established *before* the first
 * image is written rather than on first `put`. A run that writes three hundred
 * PNGs and dies before committing has already made the mess that
 * `.gitattributes` exists to prevent; there is no later moment at which adding
 * the line retroactively converts them.
 */
export async function createLfsStore(options: LfsStoreOptions): Promise<LfsStore> {
  const template = parseBaselinePath(options.path ?? DEFAULT_BASELINE_PATH);
  // Every image this store writes is a WebP. A `.png` kept before stays under
  // the entry that tracked it then, never removed here, until an accept replaces it.
  const pattern = options.pattern ?? attributesPattern(`${template.glob}.webp`);
  const attributesFile = options.attributesFile ?? join(options.root, '.gitattributes');

  const placed = options.path === undefined ? {} : { path: options.path };
  const records = options.recordRoot === undefined ? {} : { recordRoot: options.recordRoot };
  const run = options.git ?? runCommand;
  // `verify: false` keeps git out of the store entirely, fetches included: a
  // pointer then meets the refusal below. With verification on, a pointer is
  // pulled, and a pull that fails is refused by the fetching reader instead.
  const fetching =
    options.verify === false ? {} : { readImage: fetchingReader(options.root, run) };
  const projects = options.projects === undefined ? {} : { projects: options.projects };
  const baselines = createDurableStore(options.root, { ...placed, ...records, ...projects, ...fetching });
  // No `records` and no `path` for the cache: it is keyed by document digest
  // and names no subject, and its records are as regenerable as its images.
  const cache = options.cacheRoot === undefined ? baselines : createDurableStore(options.cacheRoot);

  // Ordered: writing the entry creates the directory that the check then runs
  // in, and a check in a directory that does not exist fails to spawn, which
  // this file would otherwise have to report as "git is missing".
  const entry = await ensureEntry(attributesFile, pattern);
  const checked =
    options.verify === false
      ? {
          filter: null,
          diagnostics: [
            'tracking was not verified: `verify: false` was set, so git was never asked ' +
              `whether \`${pattern}\` is routed through LFS`,
          ],
        }
      : await checkTracking(dirname(attributesFile), pattern, run);

  const tracking: LfsTracking = {
    attributesFile,
    pattern,
    added: entry.added,
    filter: checked.filter,
    diagnostics: [...entry.diagnostics, ...checked.diagnostics],
  };

  return {
    retention: 'durable',
    tracking,

    async find(key, identity): Promise<Found | null> {
      const found = await baselines.find(key, identity);
      if (found !== null) refuseAPointer(found.raster, `the baseline for \`${key.subject}\``);
      return found;
    },

    /**
     * Delegated whole, pointer check and all — because there is nothing to check.
     *
     * A description is read from the `.json`, and the sidecars are deliberately
     * outside the tracked glob, so they are real text on every clone whether or
     * not git-lfs is installed. The image beside one may well be 130 bytes of
     * pointer, and this call will not notice.
     *
     * That is sound rather than overlooked. An answer built from a digest never
     * depended on the pixels: "the document this run assembled is the one that
     * baseline was painted from" is a fact about two committed text files, and it
     * is as true on an unsmudged clone as anywhere else. The moment a caller needs
     * the image — because the document moved, and something must be compared — it
     * calls `find`, and `find` fetches the image or refuses the pointer.
     *
     * This is where a clone that skipped the smudge saves its download: a
     * subject settled here never fetches its image. *What it costs.* Where the
     * image cannot be fetched — git-lfs missing, credentials wrong — a run where
     * nothing changed passes green without discovering it, and the operator
     * finds out on the first subject that moves. Probing every PNG to say so
     * earlier would spend the lookup this method exists to avoid.
     */
    describe(key, identity): Promise<Described | null> {
      return baselines.describe(key, identity);
    },

    put(key, raster): Promise<void> {
      return baselines.put(key, raster);
    },

    /** Delegated whole: the collision it refuses is the durable store's to find. */
    expect(keys): void {
      baselines.expect?.(keys);
    },

    /**
     * Delegated whole: it reads directory entries and never opens a file, so the
     * pointer problem cannot reach it. Spread rather than written out, so a
     * delegate without the method leaves this store without it too — answering
     * `[]` on its behalf would turn "cannot enumerate" into "holds nothing".
     */
    ...(baselines.unplanned === undefined
      ? {}
      : { unplanned: baselines.unplanned.bind(baselines) }),

    // The pointer refusal stays, and under the never-throws rule it now reads as
    // a miss rather than as an error — which is the right answer here and not a
    // weakening. A cached entry that is 130 bytes of LFS pointer is not an
    // image; treating it as absent re-renders and gets the run right, where
    // returning it would compare against text. The baseline path still refuses
    // out loud, because there is nothing there to re-derive.
    renderCache: neverFails({
      async get(digest, identity): Promise<Raster | null> {
        const raster = await cache.renderCache.get(digest, identity);
        if (raster !== null) refuseAPointer(raster, `the cached render of ${digest}`);
        return raster;
      },

      put(raster): Promise<void> {
        return cache.renderCache.put(raster);
      },
    }),
  };
}

/**
 * `execFile`, with the two failures separated.
 *
 * A non-zero exit resolves — that is git talking. A spawn failure rejects — that
 * is git being absent. Node reports the first as a numeric `code` on the error
 * and the second as a string one, which is the only place the distinction is
 * available.
 *
 * Exported because the changelog reader beside this file asks git a different
 * question and must not answer it with a second runner that draws the line
 * between those two failures somewhere else. A reader that treated "git is not
 * installed" as an exit code would report it as an empty history.
 */
export const runCommand: CommandRunner = (command, args, options) =>
  new Promise<CommandResult>((resolve, reject) => {
    execFile(
      command,
      [...args],
      { cwd: options.cwd, encoding: 'utf8' },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout, stderr });
          return;
        }
        const { code } = error;
        if (typeof code !== 'number') {
          reject(error instanceof Error ? error : new Error(String(error)));
          return;
        }
        resolve({ code, stdout, stderr });
      },
    );
  });
