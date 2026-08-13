import { execFile } from 'node:child_process';
import { readdirSync, type Dirent } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';
import type { HistoryStore } from '@variance-authority/history';
import { createHttpHistoryStore } from '@variance-authority/history/client';
import type { PngDecoder } from '@variance-authority/png';
import { createEphemeralStore, type RasterStore } from '@variance-authority/raster';
import { createRemoteStore } from '@variance-authority/remote';
import { createDurableStore, createLfsStore } from '@variance-authority/store';
import {
  digestString,
  relationsOfFiles,
  type Relations,
  type SourceIndex,
} from '@variance-authority/core';
import type { Config } from '../config.js';
import { indexOf } from './affected.js';
import { OperatorError } from '../exit.js';

/**
 * The machine-shaped things a run needs before it can start: a decoder, a store,
 * a place to put bytes.
 *
 * Together in one file because they share a single rule, and it is the rule that
 * makes them safe to resolve outside the operator's config: **none of these may
 * change a verdict.** A store swapped for another must decide the same thing
 * about the same inputs (spec 0004); the two PNG decoders are held to
 * byte-identical RGBA; the render cache is content-addressed, so a wrong location
 * costs a re-render and can never produce a wrong image. That is why the
 * environment is allowed a say here and nowhere else in the configuration.
 */

/**
 * Pick the PNG decoder, preferring the fast one and never failing over it.
 *
 * Decoding is 90% of a raster comparison (journal 0016), and libvips is 1.5×
 * `pngjs` per image and up to 12× when several decode at once, because it runs
 * on libuv's threadpool instead of the main thread. That is the largest single
 * lever on how long a red run takes.
 *
 * It is also a **native addon**, which means it is absent on any platform its
 * prebuilt binaries do not cover and inside any bundle that cannot carry one. So
 * `auto` degrades to `pngjs` instead of refusing to run: a machine without the
 * binary should produce the same verdicts more slowly, never no verdicts. The
 * two decoders are held to byte-identical RGBA by `decoder.test.ts`, which is
 * what makes silent substitution safe — this changes what a run *costs* and
 * never what it *decides*.
 *
 * `sharp` explicitly is the one setting that does fail loudly. An operator who
 * asked for it on a build machine wants to know the binary is missing, rather
 * than discover it as an unexplained slowdown six months later.
 */
export async function decoderFor(config: Config): Promise<PngDecoder | undefined> {
  const choice = config.decoder ?? 'auto';
  if (choice === 'pngjs') return undefined;

  try {
    const { sharpDecoder } = await import('@variance-authority/png-sharp');
    return sharpDecoder;
  } catch (error) {
    if (choice === 'sharp') {
      throw new OperatorError(
        'config sets `decoder: "sharp"` and the native decoder could not be loaded: ' +
          `${messageOf(error)}. Remove the key to fall back to pngjs automatically, or ` +
          'install a sharp build for this platform.',
        { cause: error },
      );
    }
    return undefined;
  }
}

/**
 * Where the render cache goes: outside the work tree, always.
 *
 * A durable store is also a render cache, keyed by document digest. Left where
 * the baselines are, the cache of an LFS store lands inside a tracked, LFS-routed
 * directory and is committed exactly like a baseline — and unlike a baseline it
 * gains an entry for every edit and is worthless the moment the next one lands.
 * The repository then grows without bound with images nobody will ever look at,
 * and the quota that was bought for baselines pays for them.
 *
 * **Why the environment is allowed to decide this, when nothing else is.** The
 * config file refuses inferred values because they change what is observed. This
 * one cannot: the cache is content-addressed by document digest under an identity
 * digest, so a lookup either finds an image painted from this exact document by
 * this exact machine or finds nothing. A wrong location, a stale entry, or a
 * cache shared between projects can therefore cost a re-render and can never
 * produce a wrong image. Cost, not correctness, is a thing `XDG_CACHE_HOME` is
 * entitled to decide.
 *
 * *What it costs.* Nothing prunes this directory. It is outside the repository,
 * so `git clean` will not either, and a machine that runs many suites accumulates
 * PNGs until someone deletes it — the price of not committing them instead.
 */
export function renderCacheRoot(): string {
  return cacheRoot('renders');
}

/**
 * Where a scan's memory of a repository goes: outside that repository, per root.
 *
 * The same argument as the render cache, and it holds for the same reason. Both
 * halves of what a scan remembers are content-addressed — a parse under the digest
 * of the bytes it came from, a record under that digest *and* a digest of the tree
 * shape — so a stale entry, a cache from another branch, or no cache at all costs
 * a slower scan and can never produce a different graph.
 *
 * Per root because the layout digest is one value for the whole tree: two
 * checkouts sharing one file would each discard the other's records on every run,
 * which is worse than having no cache and looks exactly like having one.
 */
export function scanCacheRoot(root: string): string {
  return join(cacheRoot('scans'), digestString(root).replace(':', '-'));
}

function cacheRoot(kind: string): string {
  const configured = process.env['XDG_CACHE_HOME'];
  // A relative `XDG_CACHE_HOME` is meaningless (the spec requires absolute) and
  // would resolve against whatever directory the run was invoked from, which is
  // how a cache ends up back inside the work tree it was moved out of.
  const base =
    configured !== undefined && configured !== '' && isAbsolute(configured)
      ? configured
      : join(homedir(), '.cache');

  return join(base, 'variance-authority', kind);
}

/**
 * Files a diff against `ref` touched, repository-relative.
 *
 * `git diff --name-only ref...HEAD` — three dots, so the comparison is against
 * the **merge base** rather than against the tip of the other branch. Two dots on
 * a branch that is behind `main` reports every file anybody else merged as
 * changed here, which would widen a selection to the whole suite for a reason
 * nobody could see.
 *
 * A failure is an operator error rather than an empty list. An empty list means
 * *this diff touched nothing*, and answering a broken `git` with it would narrow
 * a run to nothing while reporting success.
 */
export async function changedSince(ref: string): Promise<readonly string[]> {
  const run = promisify(execFile);

  try {
    const { stdout } = await run('git', ['diff', '--name-only', `${ref}...HEAD`], {
      maxBuffer: 32 * 1024 * 1024,
    });
    return stdout.split('\n').map((line) => line.trim()).filter((line) => line !== '');
  } catch (error) {
    throw new OperatorError(
      `\`--since ${ref}\` could not list what changed: ${messageOf(error)}. ` +
        'A run that answered this with an empty diff would narrow itself to nothing and report ' +
        'success, so it refuses instead. Check the ref exists and that this is a git checkout ' +
        '(a shallow CI clone often needs `fetch-depth: 0`).',
    );
  }
}

/**
 * The component index, from the directories the config names.
 *
 * The same walk both shipped collectors do, for the same reason and with the same
 * rule owner: `indexSource` in `core` decides how a file becomes an index, and
 * this decides which files. Selection needs it *before* anything is collected, so
 * it cannot borrow the collector's.
 */
export async function scanSourceDirs(
  root: string,
  dirs: readonly string[],
): Promise<SourceIndex> {
  const contents = new Map<string, string>();

  for (const dir of dirs) {
    for (const file of walkSource(isAbsolute(dir) ? dir : join(root, dir))) {
      contents.set(relative(root, file), await readFile(file, 'utf8'));
    }
  }

  return indexOf(contents);
}

/**
 * The file graph, from the same directories the component index walks.
 *
 * A dynamic import, and the one thing in this file that may not degrade quietly.
 * The other resolutions here are held to *cost, not correctness* — a slower
 * decoder decides the same thing. This one decides **what is observed**: without
 * the graph the selector falls back to declarations, and a changed file that
 * declares nothing widens the run. So a missing package is stated rather than
 * absorbed, because the alternative is a suite that quietly got slower and an
 * operator who configured a narrowing that never happened.
 *
 * `undefined` only when the operator asked for no graph at all — that is a
 * choice, and the selector already knows how to work without one.
 *
 * Both caches are opened unasked, because a scan is on the path of every run that
 * selects and the first one is the only one that should cost a repository. They
 * are keyed by content and by tree shape, so the worst a bad one can do is a full
 * scan — see `scanCacheRoot`.
 */
export async function relationsFor(root: string, dirs: readonly string[]): Promise<Relations> {
  let scanner;
  try {
    scanner = await import('@variance-authority/oxc');
  } catch (error) {
    throw new OperatorError(
      'config sets `source.relations` and the scanner could not be loaded: ' +
        `${messageOf(error)}. Install \`@variance-authority/oxc\`, or remove the key to ` +
        'select by declaration alone.',
      { cause: error },
    );
  }

  const at = scanCacheRoot(root);
  const cache = await scanner.openParseCache(join(at, 'parse.json'));
  const reuse = await scanner.openRecordCache(join(at, 'records.json'));

  const records = await scanner.scanRelations({ root, dirs, cache, reuse });
  await Promise.all([cache.save(), reuse.save()]);

  return relationsOfFiles(records);
}

const SOURCE_EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js'];
const SOURCE_EXCLUDE = ['node_modules', '.test.', '.spec.', '.stories.', 'dist/'];

function walkSource(dir: string): readonly string[] {
  const found: string[] = [];

  let entries: readonly Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // A configured directory that does not exist contributes nothing rather than
    // failing the run: the refusal that matters is an empty *index*, and the
    // selector states that itself.
    return found;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (SOURCE_EXCLUDE.some((skip) => path.includes(skip))) continue;
    if (entry.isDirectory()) found.push(...walkSource(path));
    else if (SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) found.push(path);
  }

  return found;
}

/**
 * The history record the config asks for, or nothing.
 *
 * `undefined` rather than `createAbsentStore()` when no `history` is configured,
 * and the difference is not cosmetic: the absent store answers *questions*, and
 * what the run needs to decide first is whether to compute anything at all. A run
 * with no record configured must not hash three hundred snapshots in order to
 * hand them to something that discards them.
 */
export function historyFor(config: Config): HistoryStore | undefined {
  if (config.history === undefined) return undefined;

  return createHttpHistoryStore({
    endpoint: config.history.endpoint,
    token: config.history.token,
    project: config.history.project ?? config.project,
  });
}

/**
 * The store the config asks for.
 *
 * Switching implementations must change no verdict for the same inputs (spec
 * 0004), which is why every durable variant is built on `createDurableStore`'s
 * layout rather than reimplementing the identity partition.
 */
export async function storeFor(config: Config): Promise<RasterStore> {
  if (config.retention === 'ephemeral') return createEphemeralStore();

  const baselines = config.baselines;
  if (baselines === undefined) {
    // `parseConfig` refuses this combination, so reaching it means the config was
    // built in code. Still refused rather than defaulted: a durable run that
    // invented a baseline root would compare against a directory nobody chose.
    throw new OperatorError('`durable` retention needs a `baselines` store, and none is set');
  }

  switch (baselines.kind) {
    case 'directory':
      return createDurableStore(baselines.root);
    case 'lfs':
      return createLfsStore({
        root: baselines.root,
        // The tracked root holds baselines and nothing else. See
        // {@link renderCacheRoot} for why this is not the operator's decision to
        // make in the config file and why it is safe for it not to be.
        cacheRoot: renderCacheRoot(),
        ...(baselines.pattern !== undefined ? { pattern: baselines.pattern } : {}),
      });
    case 'remote':
      return createRemoteStore({
        endpoint: baselines.endpoint,
        ...(baselines.token !== undefined ? { token: baselines.token } : {}),
      });
  }
}

/** The default artifact writer: bytes to a path, parents created. */
export async function writeArtifactToDisk(path: string, bytes: Buffer): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, bytes);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
