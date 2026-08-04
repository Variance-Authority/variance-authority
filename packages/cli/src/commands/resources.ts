import { mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join } from 'node:path';
import type { PngDecoder } from '@variance-authority/png';
import { createEphemeralStore, type RasterStore } from '@variance-authority/raster';
import { createRemoteStore } from '@variance-authority/remote';
import { createDurableStore, createLfsStore } from '@variance-authority/store';
import type { Config } from '../config.js';
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
  const configured = process.env['XDG_CACHE_HOME'];
  // A relative `XDG_CACHE_HOME` is meaningless (the spec requires absolute) and
  // would resolve against whatever directory the run was invoked from, which is
  // how a cache ends up back inside the work tree it was moved out of.
  const base =
    configured !== undefined && configured !== '' && isAbsolute(configured)
      ? configured
      : join(homedir(), '.cache');

  return join(base, 'variance-authority', 'renders');
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
