/**
 * Loading the native addon, and nothing else.
 *
 * Kept apart from [`native.ts`](./native.ts), which describes what the addon
 * answers and adapts its batches, because the instrument asks for the addon
 * from inside every test worker and must not bring the resolver with it.
 *
 * Loaded through `createRequire` because a `.node` is a CommonJS object with no
 * ESM loader. Each candidate is attempted once: the failure is a missing file
 * rather than something a retry could change.
 */

import { createRequire } from 'node:module';
import type { NativeScanner } from './native.js';

/**
 * The package holding the prebuilt addon, per platform we publish one for.
 *
 * Written out rather than composed from `process.platform` and `process.arch`,
 * because a bundler reads this file statically and a computed specifier is a
 * specifier it cannot follow. It is also the list: `optionalDependencies` in
 * this package's manifest, the directories under `npm/`, and these names are
 * one decision held in three places, and `tools/native-packages.check.ts`
 * is what keeps them the same decision.
 *
 * Keyed without a libc, because only one build per platform is published. On
 * musl the manifest's `libc` field is what keeps the glibc binary from being
 * unpacked, and a package manager that ignores it hands `require` a binary that
 * will not load — which lands in the same `catch` as a missing one.
 */
export const PLATFORMS: Readonly<Record<string, string>> = {
  'darwin-arm64': '@variance-authority/sense-darwin-arm64',
  'linux-arm64': '@variance-authority/sense-linux-arm64-gnu',
  'linux-x64': '@variance-authority/sense-linux-x64-gnu',
  'win32-x64': '@variance-authority/sense-win32-x64-msvc',
};

let loaded: NativeScanner | undefined | null;
let refusals: readonly string[] = [];

/** Where a build for a platform outside the matrix lands, relative to `dist/`. */
const LOCAL_BUILD = '../dist/native/scan.node';

/**
 * The addon, or nothing when no binary reached this machine.
 *
 * Two candidates: the package published for this platform, then a local
 * `cargo build`. The second is what lets a platform outside the matrix
 * accelerate when somebody compiles for it — `native/build.mjs` writes there
 * precisely when it has nowhere else to write.
 *
 * One binary per platform, built for the floor of it. What a newer machine
 * wants is not a narrower instruction set but a different number of workers,
 * and that is chosen at runtime where it can see the machine it is on.
 *
 * A failed load is kept rather than swallowed, because every command that
 * scans needs the addon and has nothing to answer with instead: "requires the
 * addon" without the `dlopen` message sends somebody to their package manager
 * when the loader already knew the answer was a glibc symbol.
 */
export function native(): NativeScanner | undefined {
  if (loaded !== undefined) return loaded ?? undefined;

  const require = createRequire(import.meta.url);
  const platform = `${process.platform}-${process.arch}`;
  const shipped = PLATFORMS[platform];
  const failed: string[] = [];

  for (const specifier of [...(shipped === undefined ? [] : [shipped]), LOCAL_BUILD]) {
    try {
      loaded = require(specifier) as NativeScanner;
      refusals = [];
      return loaded;
    } catch (error) {
      loaded = null;
      const reason = refusal(specifier, error);
      if (reason !== undefined) failed.push(reason);
    }
  }

  refusals =
    failed.length > 0 || shipped !== undefined
      ? failed
      : [`no prebuilt scanner is published for ${platform}`];
  return undefined;
}

/**
 * Why one candidate did not load, or nothing when its absence is not news.
 *
 * The published package not being installed is news: it names the package a
 * reader goes looking for. The local build not existing is the ordinary state
 * of every install, and saying so on each refusal would bury the line that
 * matters under one that never does.
 */
export function refusal(specifier: string, error: unknown): string | undefined {
  const { code, message } = (error ?? {}) as { code?: unknown; message?: unknown };
  const missing = code === 'MODULE_NOT_FOUND' && String(message).includes(specifier);
  if (missing) return specifier === LOCAL_BUILD ? undefined : `${specifier} is not installed`;

  return `${specifier} did not load: ${String(message ?? error).split('\n')[0]}`;
}

/**
 * The reason the addon is absent, for an error from a command that cannot run
 * without it. Nothing when it loaded.
 */
export function nativeRefusal(): string | undefined {
  if (native() !== undefined) return undefined;
  return refusals.join('; ');
}

/** Whether the native scanner is available, for a test that must say which ran. */
export function nativeAvailable(): boolean {
  return native() !== undefined;
}
