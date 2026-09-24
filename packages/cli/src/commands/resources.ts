import { said } from '../here.js';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { HistoryStore } from '@variance-authority/history';
import { createHttpHistoryStore } from '@variance-authority/history/client';
import type { PngDecoder } from '@variance-authority/png';
import { cacheRootFor, type ExecutionNarrowing } from '@variance-authority/sense/test-selection';
import { createEphemeralStore, type RasterStore } from '@variance-authority/raster';
import { createRemoteStore } from '@variance-authority/remote/store';
import { createDurableStore } from '@variance-authority/store/durable';
import { createLfsStore } from '@variance-authority/store/lfs';
import type { Relations } from '@variance-authority/core/relate';
import type { Config } from '../config.js';
import type { JourneyReading } from './journeys.js';
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
 * Where the render cache goes: in the cache, never beside the baselines.
 *
 * A durable store is also a render cache, keyed by document digest. Left where
 * the baselines are, the cache of an LFS store lands inside a tracked, LFS-routed
 * directory and is committed exactly like a baseline — and unlike a baseline it
 * gains an entry for every edit and is worthless the moment the next one lands.
 * The repository then grows without bound with images nobody will ever look at,
 * and the quota that was bought for baselines pays for them.
 *
 * **Why the location is allowed to fall back to the environment, when nothing
 * else is.** The config file refuses inferred values because they change what is
 * observed. This one cannot: the cache is content-addressed by document digest
 * under an identity digest, so a lookup either finds an image painted from this
 * exact document by this exact machine or finds nothing. A wrong location, a
 * stale entry, or a cache shared between projects can therefore cost a re-render
 * and can never produce a wrong image, so `cacheRootFor` may answer from
 * `XDG_CACHE_HOME` when the repository names no `cacheRoot`.
 *
 * *What it costs.* A directory the baselines do not reach, which is why it
 * prunes itself rather than waiting to be found. See {@link sweepRenderCache},
 * which every run applies.
 */
export function renderCacheRoot(config: Pick<Config, 'cacheRoot'>): string {
  return join(cacheOf(config), 'renders');
}

/**
 * Where suite indexes are kept: this run's, and any a share handed over.
 *
 * In the cache, on the same argument as the render cache above and with one
 * more. An index is addressed by the commit it was written at, so a wrong
 * location costs a fetch and never an answer; and because the address is a
 * commit rather than a branch, a checkout that moves between branches
 * accumulates both evaluations instead of overwriting one with the other.
 */
export function suiteIndexRoot(config: Pick<Config, 'cacheRoot'>): string {
  return join(cacheOf(config), 'suite');
}

/**
 * The cache `loadConfig` resolved, or the one this directory's repository
 * names when the config was built in code and never read from a file.
 */
function cacheOf(config: Pick<Config, 'cacheRoot'>): string {
  return config.cacheRoot ?? cacheRootFor(process.cwd());
}

/**
 * What the last run recorded entering, read against this diff.
 *
 * Absent when no snapshot has been written for this repository — the ordinary
 * state of a project whose build carries no probes, and the reason this narrows
 * nothing rather than refusing. A snapshot that exists and cannot be read is the
 * other case entirely: something wrote it, and a run that silently ignored it
 * would look identical to one that never had it.
 *
 * With `relations`, a changed file the journal holds no row for is asked of
 * the graph: its importers, and theirs, until one is a test or has a row with
 * probes behind it. Without, that file stays `unread`, which keeps no subject
 * in the run and is named in its notes. `packages` are the names the install
 * comparison says moved, and they are answered by the measured files that
 * import them, so they are only heard when `relations` is given too.
 *
 * Every changed module is checked against the text it was recorded from before
 * its line ranges are read, because a snapshot is recorded by being *run* and a
 * suite is run over a dirty tree far more often than a clean one. Without that
 * check the hunks of this diff are charged to whatever region happens to sit at
 * those numbers now — a different region, belonging to different subjects, or to
 * none at all, which is an exclusion nobody checked.
 */
export async function journeyAgainst(
  root: string,
  diff: string,
  relations?: Relations,
  packages: readonly string[] = [],
): Promise<ExecutionNarrowing | undefined> {
  const selection = await import('@variance-authority/sense/test-selection');
  const file = selection.testCoverageFile(root);
  const sourceAt = selection.textAtRecording(root, selection.changedLines(diff).keys());

  try {
    return await selection.narrowByExecution(file, diff, {
      sourceAt,
      ...(relations === undefined ? {} : { relations }),
      ...(packages.length === 0 ? {} : { packages }),
    });
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw new OperatorError(
      `the recorded execution journal at ${said(file)} could not be read: ${messageOf(error)}. ` +
        'Delete it and run once without `--since` to record a new one; a run that ignored it ' +
        'would look exactly like a run that never had one.',
      { cause: error },
    );
  }
}

/**
 * The recorded partings, and the pool they were drawn from.
 *
 * Beside `journeyAgainst`, reading the same snapshot for the other question:
 * that one asks *who can be ruled out of this diff*, this one asks *who took a
 * different path through the same module*. The absence rule is the same and the
 * failure is not — a missing snapshot narrows nothing there and answers nothing
 * here, so both are reported rather than either being read as a clean result.
 *
 * The pool is returned alongside the findings because it cannot be recovered
 * from them. An observer that entered no module with source of its own appears
 * in no divergence at all, and a truncated observation appears in none by rule,
 * so a caller holding only `found` cannot tell a pool of two from a pool of
 * five that mostly went nowhere.
 */
export async function recordedJourneys(
  root: string,
  observers?: readonly string[],
  /** A snapshot somewhere other than this repository's cache — one `landJourneys` just wrote. */
  at?: string,
): Promise<JourneyReading> {
  const selection = await import('@variance-authority/sense/test-selection');
  const file = at ?? selection.testCoverageFile(root);

  let coverage;
  try {
    coverage = await selection.readTestCoverage(file);
  } catch (error) {
    // The path either way. An operator whose build carries no probes has to be
    // told where the file this wanted would have been, and that is precisely the
    // reading with no snapshot to carry it.
    if (isMissing(error)) return { at: file };
    throw new OperatorError(
      `the recorded execution journal at ${file} could not be read: ${messageOf(error)}. ` +
        'Delete it and run once to record a new one; a reading that skipped it would look ' +
        'exactly like a repository that never recorded anything.',
      { cause: error },
    );
  }

  const wanted = observers === undefined ? undefined : new Set(observers);
  const held = new Set(coverage.tests.map((test) => test.file));
  const inScope = coverage.tests.filter((test) => wanted === undefined || wanted.has(test.file));

  const entered = new Map<string, Set<string>>();
  for (const module of coverage.modules) {
    if (!module.instrumented) continue;
    for (const block of module.blocks) {
      if (!block.source) continue;
      for (const test of block.testFiles) {
        if (wanted !== undefined && !wanted.has(test)) continue;
        let names = entered.get(test);
        if (names === undefined) entered.set(test, (names = new Set()));
        names.add(block.name);
      }
    }
  }

  return {
    at: file,
    entered: new Map(
      [...entered].sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([subject, names]) => [subject, sorted([...names])]),
    ),
    recorded: {
      ...(coverage.commit === undefined ? {} : { commit: coverage.commit }),
      whole: sorted(inScope.filter((test) => test.complete).map((test) => test.file)),
      // Counted, not dropped. The instrument excludes these because a recording
      // that stopped early cannot prove an absence; a caller that could not see
      // how many it excluded would read a shrunken pool as an agreeing one.
      truncated: sorted(inScope.filter((test) => !test.complete).map((test) => test.file)),
      unrecorded: sorted((observers ?? []).filter((name) => !held.has(name))),
      found: selection.journeyDivergences(
        coverage,
        observers === undefined ? {} : { observers },
      ),
    },
  };
}

/** Unique, in the code-unit order every other list in the snapshot is sorted by. */
function sorted(names: readonly string[]): readonly string[] {
  return [...new Set(names)].sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

export function isMissing(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
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
      // Same rule as the LFS arm below, and for the same reason: every on-disk
      // placement in `docs/placement.md` is a directory the operator commits, so
      // the tracked root holds baselines and nothing else. See
      // {@link renderCacheRoot}.
      return createDurableStore(baselines.root, {
        cacheRoot: renderCacheRoot(config),
        ...(baselines.layout !== undefined ? { layout: baselines.layout } : {}),
        // The operator's, unlike the cache root above. A record that is not
        // there costs the run evidence a verdict may turn on, so where it goes
        // is a decision this process is not entitled to make on its own.
        ...(baselines.records !== undefined ? { recordRoot: baselines.records } : {}),
      });
    case 'lfs':
      return createLfsStore({
        root: baselines.root,
        // The tracked root holds baselines and nothing else. See
        // {@link renderCacheRoot} for why this is not the operator's decision to
        // make in the config file and why it is safe for it not to be.
        cacheRoot: renderCacheRoot(config),
        ...(baselines.pattern !== undefined ? { pattern: baselines.pattern } : {}),
        ...(baselines.layout !== undefined ? { layout: baselines.layout } : {}),
        ...(baselines.records !== undefined ? { recordRoot: baselines.records } : {}),
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

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
