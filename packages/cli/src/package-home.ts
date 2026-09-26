/**
 * The package a file belongs to, as its manifest says.
 *
 * The manifest is the package boundary — the same rule the scanner follows —
 * so the nearest `package.json` at or above a file is its package, and the
 * walk stops at the root so a workspace never resolves to whatever manifest
 * happens to sit above the checkout. Synchronous because it is a handful of
 * `stat` calls per distinct directory, and remembered because one answer asks
 * about the same directories over and over.
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

/** The directory of the nearest manifest at or above a file, inside the root; `undefined` when there is none. */
export function packageOf(root: string, file: string): string | undefined {
  const key = JSON.stringify([root, file]);
  const cached = HOMES.get(key);
  if (cached !== undefined) return cached === '' ? undefined : cached;

  let at = dirname(resolve(root, file));
  let home: string | undefined;
  for (;;) {
    if (existsSync(join(at, 'package.json'))) {
      home = at;
      break;
    }
    if (at === root) break;
    const up = dirname(at);
    if (up === at) break;
    at = up;
  }
  HOMES.set(key, home ?? '');
  return home;
}

/**
 * What a reader calls the package at `home`: the manifest's `name`, or, for a
 * manifest that declares none, its directory inside the root.
 */
export function packageName(root: string, home: string): string {
  let name: unknown;
  try {
    name = (JSON.parse(readFileSync(join(home, 'package.json'), 'utf8')) as { name?: unknown }).name;
  } catch {
    // A manifest that does not parse still bounds the package; it only has no name to give.
  }
  return typeof name === 'string' && name !== '' ? name : relative(root, home) || '.';
}

/** One process asks about one root, so the walk is worth remembering. */
const HOMES = new Map<string, string>();
