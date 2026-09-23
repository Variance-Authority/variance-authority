/**
 * Which files a scan reads, and what their names say about them.
 *
 * Everything here is answered by a path, before a byte is opened: which paths
 * exist under the configured roots, which of them are worth reading at all, and
 * what a name implies about the bytes behind it — the language it is read as,
 * the dialect that language's parser is handed, whether its declarations count
 * as components. [`scan.ts`](./scan.ts) asks; the answers live here because they
 * are about naming and walking rather than about the graph.
 *
 * The distinction this file draws is the one the parse cache is keyed on. Two
 * files holding one content are the same parse only if their names said to read
 * them the same way, so the key is built from a digest and from exactly the
 * properties below — not from the path, which would defeat the sharing that
 * cache exists for ([`cache.ts`](./cache.ts)).
 */

import { readdirSync, type Dirent } from 'node:fs';
import { basename, extname, isAbsolute, join } from 'node:path';
import type { Digest } from './digest.js';
import type { ParseKey } from './cache.js';
import { languageOf, READABLE, type LanguageId } from './language.js';
import { EXCLUDE_DIRS, toRepoPath } from './resolve.js';

/** The extensions a scan opens: every language some reader claims. */
export { READABLE } from './language.js';

/** Every readable file under the configured roots, named the way the scan keys them. */
export function seedFiles(root: string, dirs: readonly string[]): readonly string[] {
  const found: string[] = [];
  for (const dir of dirs) {
    const absolute = isAbsolute(dir) ? dir : join(root, dir);
    // The walk descends into known directories, so it can spell the relative
    // path as it goes instead of deriving it again from every file it finds.
    const prefix = absolute === root ? '' : toRepoPath(root, absolute);
    if (prefix !== undefined) walk(absolute, prefix, found);
  }

  return found;
}

/** Every Git-visible readable path below the configured roots. */
export function seedPaths(
  root: string,
  dirs: readonly string[],
  paths: readonly string[],
): readonly string[] {
  const prefixes = dirs.flatMap((dir) => {
    const absolute = isAbsolute(dir) ? dir : join(root, dir);
    const prefix = absolute === root ? '' : toRepoPath(root, absolute);
    return prefix === undefined ? [] : [prefix];
  });

  return paths.filter((file) =>
    READABLE.has(extname(file)) && prefixes.some((prefix) => below(file, prefix)));
}

function below(file: string, prefix: string): boolean {
  const relative = prefix === ''
    ? file
    : file.startsWith(`${prefix}/`)
      ? file.slice(prefix.length + 1)
      : '';
  if (relative === '') return false;
  const directories = relative.split('/').slice(0, -1);
  // A tracked directory named `build` is source by Git's own evidence. The
  // filesystem walk still excludes generated build output; only a Git-visible
  // path reaches this predicate.
  return !directories.some((part) => part !== 'build' && EXCLUDE_DIRS.includes(part));
}

/**
 * Every readable file under one directory, unless it is a repository of its own.
 *
 * A checkout inside a checkout — a worktree cut this morning, a vendored clone —
 * is a different repository that happens to sit at this path. Git tracks not one
 * file of it, so every file misses the digest lookup and is opened and parsed on
 * every run; and its files are another repository's copies of these ones, which
 * doubles every count taken over the walk. Neither is a judgement call, and the
 * directory listing already in hand says which directories those are.
 *
 * A seed is never tested this way, only what is found beneath it: a caller that
 * points the scan at a checkout means that checkout.
 */
function walk(dir: string, prefix: string, into: string[], seeded = true): void {
  let entries: readonly Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // A configured directory that is not there contributes nothing. The refusal
    // that matters is an empty result, and the caller is the one that can say
    // whether an empty result is wrong.
    return;
  }

  if (!seeded && entries.some((entry) => entry.name === '.git')) return;

  for (const entry of entries) {
    const at = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!EXCLUDE_DIRS.includes(entry.name)) walk(join(dir, entry.name), at, into, false);
    } else if (READABLE.has(extname(entry.name))) into.push(at);
  }
}

/** Files whose declarations are not components, matching the component index. */
const NOT_DECLARING = ['.test.', '.spec.', '.stories.', '.d.ts'];

/**
 * Everything about a path that changes what its bytes mean, and nothing else.
 *
 * There are two things. The name picks the language it is read as and the
 * dialect handed to that language's parser, and it decides separately whether
 * the file is indexed for component declarations — a
 * `.test.ts` is not. Read once, here, and carried to both the cache key and the
 * parse: a key and a parse that each work the path out for themselves is the
 * shape that lets them disagree, and the disagreement is silent.
 */
export interface ParseWay {
  /** Every extension the basename carries: `.ts`, `.test.ts`, `.d.mts`. */
  readonly suffix: string;
  readonly declaring: boolean;
}

export function parseWay(file: string): ParseWay {
  const name = basename(file);
  // From the *first* dot, not the last. `.d.mts` and `.mts` are different
  // dialects and `extname` cannot tell them apart.
  const dot = name.indexOf('.', 1);

  return {
    suffix: dot === -1 ? '' : name.slice(dot),
    declaring: !NOT_DECLARING.some((skip) => file.includes(skip)),
  };
}

/**
 * Which language this is read as, which the suffix already decided.
 *
 * Derived rather than carried, because the answer is wanted only where a file is
 * actually opened and the way is built for every file in the repository. Nothing
 * is the answer for a suffix no reader claims ([`language.ts`](./language.ts)),
 * which a walk seeded from {@link READABLE} cannot produce but a caller handed a
 * path from somewhere else can.
 */
export function languageFor(way: ParseWay): LanguageId | undefined {
  return languageOf(way.suffix);
}

/**
 * The parse cache's key: these bytes, read this way.
 *
 * Joined with a separator no path can hold rather than hashed, because this runs
 * once per file in the repository on every run — including the runs that open
 * nothing at all ([`cache.ts`](./cache.ts) carries the measurement).
 */
// FIXME: the key names the file's bytes and never the reader that read them, so a
// build whose reader answers differently — a native addon rebuilt, a language
// reader changed — reuses the old parse, and the record resolved from it, until
// the file itself changes. A published index is updated and never rebuilt, so
// nothing else ever replaces that answer; only a format version bump does.
export function keyFor(digest: Digest, way: ParseWay): ParseKey {
  return `${digest}\u0000${way.suffix}\u0000${way.declaring ? '+' : '-'}`;
}
