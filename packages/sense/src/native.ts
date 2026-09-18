/**
 * The native scanner, when this checkout built one.
 *
 * It is an acceleration of the TypeScript scanner and never a replacement for
 * it: every answer it gives, the JavaScript path gives too, and the differential
 * tests are what say so. So a missing addon is not a degraded mode to warn
 * about — it is the implementation of record, running.
 *
 * Loaded through `createRequire` because a `.node` is a CommonJS object with no
 * ESM loader, and behind a single failed attempt because the failure is a
 * missing file rather than something a retry could change.
 */

import { createRequire } from 'node:module';

/** Every tracked path under a root, with the digest of the bytes on disk. */
export interface NativeGitTree {
  readonly size: number;
  has(path: string): boolean;
  digest(path: string): string | null;
  paths(): string[];
  digests(): string[];
  named(names: string[]): string[];
  directories(): Record<string, string>;
  configDigest(header: string[], names: string[], aliasesUnknown: boolean): string;
}

export interface NativeScanner {
  gitTree(root: string): NativeGitTree | null;
}

let loaded: NativeScanner | undefined | null;

/** The addon, or nothing when this checkout has no `cargo` or did not build it. */
export function native(): NativeScanner | undefined {
  if (loaded !== undefined) return loaded ?? undefined;

  try {
    const require = createRequire(import.meta.url);
    loaded = require('../dist/native/scan.node') as NativeScanner;
  } catch {
    loaded = null;
  }

  return loaded ?? undefined;
}

/** Whether the native scanner is available, for a test that must say which ran. */
export function nativeAvailable(): boolean {
  return native() !== undefined;
}
