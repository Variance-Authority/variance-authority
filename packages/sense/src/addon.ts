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
 * this package's manifest, the directories under `npm/`, and these three names
 * are one decision held in three places, and `tools/native-packages.check.ts`
 * is what keeps them the same decision.
 *
 * Keyed without a libc, because only one build per platform is published. On
 * musl the manifest's `libc` field is what keeps the glibc binary from being
 * unpacked, and a package manager that ignores it hands `require` a binary that
 * will not load — which lands in the same `catch` as a missing one.
 */
export const PLATFORMS: Readonly<Record<string, string>> = {
  'darwin-arm64': '@variance-authority/sense-darwin-arm64',
  'linux-x64': '@variance-authority/sense-linux-x64-gnu',
  'win32-x64': '@variance-authority/sense-win32-x64-msvc',
};

let loaded: NativeScanner | undefined | null;

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
 */
export function native(): NativeScanner | undefined {
  if (loaded !== undefined) return loaded ?? undefined;

  const require = createRequire(import.meta.url);
  const shipped = PLATFORMS[`${process.platform}-${process.arch}`];

  for (const specifier of [
    ...(shipped === undefined ? [] : [shipped]),
    '../dist/native/scan.node',
  ]) {
    try {
      loaded = require(specifier) as NativeScanner;
      return loaded;
    } catch {
      loaded = null;
    }
  }

  return undefined;
}

/** Whether the native scanner is available, for a test that must say which ran. */
export function nativeAvailable(): boolean {
  return native() !== undefined;
}
