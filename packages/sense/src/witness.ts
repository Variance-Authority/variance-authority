/**
 * Which directories could have answered a resolution, and therefore which ones
 * moving can change a record's edges.
 *
 * A resolver asked for `./button` from `src/panel` looks in `src/panel` for a
 * name it can extend, and in `src/panel/button` for an index. Nothing else in
 * the repository takes part in that question: ten thousand files can appear
 * under `docs/` and the answer is the answer it already was. The two
 * directories are the specifier's **witnesses**, and a record's witnesses are
 * every one its specifiers named.
 *
 * Witnesses are lexical. They are derived from the specifier rather than from
 * what it resolved to, because the interesting case is the one that resolved to
 * nothing: `./button` finds nothing today and finds `button.tsx` tomorrow, and a
 * rule that only watched answers would never look. Where a request *did* resolve,
 * the directory holding the answer is a witness as well — that is the one place
 * a `package.json` `main` can send a lookup that no lexical reading predicts,
 * and a manifest's contents are the config's business.
 *
 * ## Bare specifiers
 *
 * `react` is answered from `node_modules`, which git does not track, so no
 * tracked path can change it. A workspace package is the exception: its link
 * in `node_modules` leads back into the tree, and the resolver reads that
 * package's tracked files, its source included when its output is read as the
 * source it is built from. What changes a bare answer lexically is a
 * `tsconfig` that maps it: `@app/*` pointing at `src/*` makes `@app/button`
 * exactly as sensitive to `src` as `./button` is to its own directory. So the
 * patterns are read from the `tsconfig` and `jsconfig` files the tree holds,
 * and a request that matches one gets the substituted paths as candidates.
 *
 * A configuration's `extends` chain is folded in first, because a `paths`
 * inherited from a base is the base's answer. A base named by a path is read
 * where the path points. A base named by a package — `@org/tsconfig/base`, the
 * shape of a workspace that keeps its shared configuration in a package — is
 * asked of `oxc-resolver` under the rule it follows `extends` by, so the file
 * read here is the file the resolver itself inherits from: the package's
 * `exports`, then its `tsconfig.json`, reached through the `node_modules` link
 * the workspace manifests put there. The manifests and the lockfile that decide
 * where that link leads are already in the config digest.
 *
 * The base counts only when it lands on a configuration the tree tracks, since
 * git owns what exists and the config digest names only tracked contents. A
 * workspace package's link leads back into the tree and lands on one. A base
 * installed from a registry lands in `node_modules`, which git does not track,
 * and a base outside the checkout is no path of this repository — either could
 * change its `paths` without moving anything a record is kept under.
 *
 * So when a configuration cannot be read — invalid JSON, or an `extends` that
 * does not resolve to a configuration the tree tracks — there is no honest
 * bound on where a bare specifier could land. Aliases are then **unknown**, and
 * the caller that asks for them is expected to fall back to treating the whole
 * path set as one witness ([`reuse.ts`](./reuse.ts)).
 */

import { dirname, join, normalize } from 'node:path/posix';
import { native, nativeRefusal } from './addon.js';
import { digestString, type Digest } from './digest.js';
import { isRelative, requestOf } from './specifier.js';

/** Where a non-relative specifier could land, lexically. */
export interface Aliases {
  /** Every repo-relative path this request could name through a configuration. */
  candidatesFor(request: string): readonly string[];
  /**
   * What `candidatesFor` answers from, for a reader on the other side of the
   * addon boundary (`native/src/witness.rs`), which asks the same question of
   * the same table rather than reading the configurations a second time.
   */
  readonly table: AliasTable;
}

/** The placed `baseUrl` directories, in the order declared, and every mapping. */
export interface AliasTable {
  readonly bases: readonly string[];
  readonly mappings: readonly Mapping[];
}

export interface Mapping {
  /** The text before the pattern's `*`, or the whole pattern when it has none. */
  readonly prefix: string;
  /** The text after the `*`; absent when the pattern is exact. */
  readonly suffix?: string;
  /** Substitutions, repo-relative, each holding at most one `*`. */
  readonly targets: readonly string[];
}

/**
 * The alias patterns the tree declares, or nothing when one of them cannot be read.
 *
 * Every configuration is read, not only the one a scan was pointed at: `'auto'`
 * discovers the nearest one per file, so the bound has to hold for all of them.
 * A union over the tree is wider than any single file's answer and therefore
 * still a bound. The addon reads and folds them (`native/src/witness_aliases.rs`):
 * a large workspace holds thousands, and reading them here one at a time was a
 * sixth of a warm update.
 */
export async function aliasesIn(
  root: string,
  paths: Iterable<string>,
): Promise<Aliases | undefined> {
  const read = native();
  if (read === undefined) throw new Error(`aliases are read by the native scanner, and ${nativeRefusal() ?? 'it did not load'}`);
  const held = read.aliasesIn(root, [...paths]);
  if (held === null) return undefined;
  const mappings: Mapping[] = held.mappings.map((mapping) =>
    mapping.suffix === undefined || mapping.suffix === null
      ? { prefix: mapping.prefix, targets: mapping.targets }
      : { prefix: mapping.prefix, suffix: mapping.suffix, targets: mapping.targets });
  const bases = held.bases;

  return {
    table: { bases, mappings },
    candidatesFor(request) {
      const found: string[] = [];
      for (const base of bases) found.push(join(base, request));
      for (const mapping of mappings) {
        const matched = match(mapping, request);
        if (matched === undefined) continue;
        for (const target of mapping.targets) {
          found.push(matched === null ? target : target.replace('*', matched));
        }
      }
      return found;
    },
  };
}

/** The wildcard's text, `null` for an exact hit, or nothing when it does not match. */
function match(mapping: Mapping, request: string): string | null | undefined {
  if (mapping.suffix === undefined) return request === mapping.prefix ? null : undefined;
  if (!request.startsWith(mapping.prefix) || !request.endsWith(mapping.suffix)) return undefined;
  if (request.length < mapping.prefix.length + mapping.suffix.length) return undefined;
  return request.slice(mapping.prefix.length, request.length - mapping.suffix.length);
}

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

/**
 * The directories a record's edges depend on, sorted and without repeats.
 *
 * The specifiers rather than the edges, because a request that resolved to
 * nothing is the one most likely to start resolving.
 */
export function witnessesOf(input: {
  /** The importing file, repo-relative. */
  readonly file: string;
  /** Every specifier the file wrote down, as written. */
  readonly requests: Iterable<string>;
  /** Where its requests landed, repo-relative. */
  readonly edges: Iterable<string>;
  /** Every directory the tree holds ([`directoriesOf`](#directoriesOf)). */
  readonly directories: ReadonlyMap<string, Digest>;
  readonly aliases: Aliases | undefined;
}): readonly string[] {
  const { file, requests, edges, directories, aliases } = input;
  const directory = parent(file);
  const found = new Set<string>();
  const candidate = (path: string): void => {
    const at = within(path);
    if (at === undefined) return;
    // The candidate itself only while it is a directory, because a directory
    // that is not one yet cannot appear without its parent gaining an entry —
    // and the parent is the other witness.
    if (directories.has(at)) found.add(at);
    found.add(parent(at));
  };

  for (const value of requests) {
    const request = requestOf(value);
    if (request === undefined) continue;
    const bare = request.startsWith('~') ? request.slice(1) : request;
    if (isRelative(bare)) candidate(join(directory, bare));
    else for (const alias of aliases?.candidatesFor(bare) ?? []) candidate(alias);
  }
  // FIXME: a bare request into a workspace package that resolved to nothing has
  // no witness in that package, so a reused record misses the source file that
  // would make it resolve — `@s/b/new`, written before `new.ts` was added to
  // that package's `rootDir`. The resolver knows where it looked, through the package's link and
  // `tsconfig` layout, and the batch does not carry it.
  for (const edge of edges) found.add(parent(edge));

  return [...found].sort();
}

/** A path's directory, with the repository root written as the empty string. */
function parent(path: string): string {
  const at = dirname(path);
  return at === '.' || at === '/' ? '' : at;
}

/** A repository-relative path, or nothing when it names something outside. */
function within(path: string): string | undefined {
  const normalized = normalize(path);
  if (normalized === '.' || normalized === '') return '';
  return normalized.startsWith('../') || normalized === '..' ? undefined : normalized;
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
