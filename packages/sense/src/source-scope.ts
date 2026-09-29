// compass: variance-authority.reach.source-index
/**
 * Which source files one part of a repository is made of, and how big each is.
 *
 * A monorepo holds several things that are measured apart: a tooling folder, an
 * application, a widget. `--from <dir>` names one, and its source is what that
 * directory's entry points reach along the imports the scan recorded — so a
 * shared package the application imports is part of the application, and a
 * sibling application is not. The entry points are the repository's to declare,
 * in the `entrypoints` key of the root config, because only the repository knows
 * that an application starts at `src/main.tsx` and a Next.js one at every file
 * under `app/`:
 *
 * ```json
 * { "entrypoints": { "packages/apps/main": ["src/main.tsx"], "packages/apps/next": ["app/**"] } }
 * ```
 *
 * A directory with none declared is seeded from every file under it, and the
 * answer says so: the closure is then the directory and what it imports, which
 * is wider than what it ships. No directory means every file the index holds.
 *
 * The sizes are the ones the scan stored on each parse ({@link SourceSize}),
 * joined to a file through the digest its record was read from. Nothing here
 * opens a file.
 */

import type { FileRecord } from '@variance-authority/core/relate';
import type { ParseKey, Parsed } from './cache.js';
import { keyFor, parseWay } from './files.js';
import { directoryOf, type Entrypoints } from './test-selection/entrypoints.js';

/** One part of the repository, as the files it is made of. */
export interface SourceScope {
  /** The directory asked about, repository-relative. Absent for the whole repository. */
  readonly from?: string;
  /** What the closure started from: declared entry points, every file under `from`, or every file held. */
  readonly seeds: 'entrypoints' | 'directory' | 'everything';
  /** The declared patterns that matched no file the index holds. Absent when none was declared. */
  readonly unmatched?: readonly string[];
  /** Every file reached, sorted by code unit. */
  readonly files: readonly string[];
}

/**
 * The files `from` reaches along the recorded imports, from its declared entry
 * points or, without them, from every file under it. Without `from`, every file.
 */
export function sourceScope(records: readonly FileRecord[], from?: string, entrypoints?: Entrypoints): SourceScope {
  const all = records.map((record) => record.file).sort(byCodeUnit);
  if (from === undefined) return { seeds: 'everything', files: all };
  const dir = directoryOf(from);
  if (dir === undefined) throw new Error(`"${from}" is not a directory inside the repository`);

  const under = dir === '' ? all : all.filter((file) => file.startsWith(`${dir}/`));
  if (under.length === 0) throw new Error(`the source index holds no file under "${from}"; spell the directory from the repository root`);
  const patterns = entrypoints?.get(dir);
  let seeds = under;
  let unmatched: string[] | undefined;
  if (patterns !== undefined) {
    const at = dir === '' ? '' : `${dir}/`;
    unmatched = [];
    const matched = new Set<string>();
    for (const pattern of patterns) {
      const glob = globOf(pattern);
      const hits = under.filter((file) => glob.test(file.slice(at.length)));
      if (hits.length === 0) unmatched.push(pattern);
      for (const hit of hits) matched.add(hit);
    }
    seeds = [...matched];
  }

  const byFile = new Map(records.map((record) => [record.file, record]));
  const reached = new Set<string>();
  const queue = [...seeds];
  for (let head = 0; head < queue.length; head += 1) {
    const file = queue[head]!;
    if (reached.has(file)) continue;
    const record = byFile.get(file);
    if (record === undefined) continue;
    reached.add(file);
    for (const edge of record.edges ?? []) queue.push(edge.to);
  }

  return {
    ...(dir === '' ? {} : { from: dir }),
    seeds: patterns === undefined ? 'directory' : 'entrypoints',
    ...(unmatched === undefined ? {} : { unmatched }),
    files: [...reached].sort(byCodeUnit),
  };
}

/** One file's size, as its parse stored it. */
export interface FileSize {
  readonly file: string;
  readonly bytes: number;
  /** Lines holding code: not blank, not only a comment. */
  readonly lines: number;
  /** Regions the instrument would cut. Absent when the parse had a diagnostic. */
  readonly blocks?: number;
  /** Absent when the parse was never asked what the file exports. */
  readonly exports?: number;
}

/**
 * The size of every file in `files` whose parse carries one, in the order given.
 * A file whose language stores no size, or whose record has no digest, is left
 * out rather than counted as empty.
 */
export function fileSizes(
  records: readonly FileRecord[],
  parses: { get(key: ParseKey): Parsed | undefined },
  files: Iterable<string>,
): readonly FileSize[] {
  const byFile = new Map(records.map((record) => [record.file, record]));
  const sizes: FileSize[] = [];
  for (const file of files) {
    const digest = byFile.get(file)?.digest;
    const parsed = digest === undefined ? undefined : parses.get(keyFor(digest, parseWay(file)));
    const size = parsed?.size;
    if (size === undefined) continue;
    sizes.push({
      file,
      bytes: size.bytes,
      lines: size.lines,
      ...(size.blocks === undefined ? {} : { blocks: size.blocks }),
      ...(parsed!.exports === undefined ? {} : { exports: parsed!.exports.length }),
    });
  }
  return sizes;
}

/** Whether `path` matches `pattern`, under the rules `entrypoints` are written in. */
export function matchesGlob(pattern: string, path: string): boolean {
  return globOf(pattern).test(path);
}

// `**` followed by a slash is any number of directories, `**` at the end is
// anything, `*` a run within one segment and `?` one character. Nothing else is
// special.
function globOf(pattern: string): RegExp {
  let source = '';
  for (let at = 0; at < pattern.length; at += 1) {
    const char = pattern[at]!;
    if (pattern.startsWith('**/', at)) {
      source += '(?:[^/]*/)*';
      at += 2;
    } else if (pattern.startsWith('**', at) && at + 2 === pattern.length) {
      source += '.*';
      at += 1;
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`, 'u');
}

function byCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
