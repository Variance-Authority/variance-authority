/**
 * Directory membership for source-record reuse and configuration text parsing.
 */

import { digestString } from './digest.js';
import type { Digest } from '@variance-authority/core/format';

/** Every directory in the tree, named by the entries it holds. */
export function directoriesOf(paths: Iterable<string>): ReadonlyMap<string, Digest> {
  const members = new Map<string, Set<string>>();
  const add = (directory: string, name: string): void => {
    let held = members.get(directory);
    if (held === undefined) members.set(directory, (held = new Set()));
    held.add(name);
  };

  for (const path of paths) {
    let at = 0;
    for (;;) {
      const slash = path.indexOf('/', at);
      const parent = at === 0 ? '' : path.slice(0, at - 1);
      if (slash === -1) {
        add(parent, path.slice(at));
        break;
      }
      add(parent, path.slice(at, slash));
      at = slash + 1;
    }
  }

  const digests = new Map<string, Digest>();
  for (const [directory, held] of members) {
    digests.set(directory, digestString([...held].sort().join('\n')));
  }

  return digests;
}

/** Every directory whose entries differ between two trees. */
export function movedDirectories(
  before: ReadonlyMap<string, Digest>,
  after: ReadonlyMap<string, Digest>,
): ReadonlySet<string> {
  const moved = new Set<string>();
  for (const [directory, digest] of after) if (before.get(directory) !== digest) moved.add(directory);
  for (const directory of before.keys()) if (!after.has(directory)) moved.add(directory);

  return moved;
}

/** A configuration file's text as an object, or nothing when it is not one. */
export function parseConfig(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(stripComments(text.replace(/^\uFEFF/u, '')).replace(/,(\s*[}\]])/gu, '$1'));
    return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function stripComments(text: string): string {
  let out = '';
  let at = 0;
  let inString = false;
  while (at < text.length) {
    const char = text[at]!;
    if (inString) {
      out += char;
      if (char === '\\') { out += text[at + 1] ?? ''; at += 2; continue; }
      if (char === '"') inString = false;
      at += 1;
      continue;
    }
    if (char === '"') { inString = true; out += char; at += 1; continue; }
    if (char === '/' && text[at + 1] === '/') {
      const end = text.indexOf('\n', at);
      at = end === -1 ? text.length : end;
      continue;
    }
    if (char === '/' && text[at + 1] === '*') {
      const end = text.indexOf('*/', at + 2);
      at = end === -1 ? text.length : end + 2;
      continue;
    }
    out += char;
    at += 1;
  }

  return out;
}
