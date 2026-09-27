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

import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path/posix';
import { basename, relative, sep } from 'node:path';
import { ResolverFactory, type NapiResolveOptions } from 'oxc-resolver';
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

/** Configuration files whose `paths` decide where a bare specifier can land. */
function isConfig(path: string): boolean {
  const name = basename(path);
  return name === 'jsconfig.json' || (name.startsWith('tsconfig') && name.endsWith('.json'));
}

/** One configuration's options, and which file in its chain wrote each of them. */
interface Options {
  readonly values: Record<string, unknown>;
  /** Option name to the configuration that declared it, which places its value. */
  readonly from: ReadonlyMap<string, string>;
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
 * still a bound.
 */
export async function aliasesIn(
  root: string,
  paths: Iterable<string>,
): Promise<Aliases | undefined> {
  const configs = [...paths].filter(isConfig);
  const parsed = new Map<string, Record<string, unknown>>();
  for (const path of configs) {
    const value = await readConfig(join(root, path));
    if (value === undefined) return undefined;
    parsed.set(path, value);
  }

  const extended = extendedIn(root, parsed);
  const mappings: Mapping[] = [];
  const bases = new Set<string>();
  const already = new Set<string>();
  // The `paths` one file declares, placed against one directory, is one table
  // however many configurations inherit it. A workspace whose 1,500 package
  // configurations extend a root of 3,000 patterns would otherwise place four
  // and a half million patterns to keep three thousand, on every scan.
  const placedFrom = new Set<string>();
  for (const path of configs) {
    const options = compilerOptions(path, parsed, extended);
    if (options === undefined) return undefined;
    const declared = options.values['paths'];
    const baseUrl = options.values['baseUrl'];
    // Each option is placed against the file that wrote it rather than the file
    // that inherited it, which is what TypeScript does and the only reading that
    // names real directories: a package config extending the root's `paths`
    // means the root's `./packages/x/src`, not its own.
    const base = typeof baseUrl === 'string'
      ? within(join(dirname(options.from.get('baseUrl') ?? path), baseUrl))
      : within(dirname(options.from.get('paths') ?? path));
    if (base === undefined) continue;
    if (typeof baseUrl === 'string') bases.add(base);
    if (declared === undefined || declared === null || typeof declared !== 'object') continue;
    const placement = `${options.from.get('paths') ?? path}\u0000${base}`;
    if (placedFrom.has(placement)) continue;
    placedFrom.add(placement);
    for (const [pattern, targets] of Object.entries(declared as Record<string, unknown>)) {
      if (!Array.isArray(targets)) return undefined;
      const placed = targets
        .filter((target): target is string => typeof target === 'string')
        .map((target) => within(join(base, target)))
        .filter((target): target is string => target !== undefined);
      // Two files declaring one pattern with the same targets are one mapping.
      const key = `${pattern}\u0000${placed.join('\u0000')}`;
      if (already.has(key)) continue;
      already.add(key);
      const star = pattern.indexOf('*');
      mappings.push(star === -1
        ? { prefix: pattern, targets: placed }
        : { prefix: pattern.slice(0, star), suffix: pattern.slice(star + 1), targets: placed });
    }
  }

  return {
    table: { bases: [...bases], mappings },
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

/**
 * The options `oxc-resolver` follows an `extends` by, which are not the ones it
 * resolves a module by: a package's `exports` under `node` and `import`, `.json`
 * as the one extension, and `tsconfig.json` as a package's index. Asking under
 * any other set could answer a file the resolver never inherits from.
 */
const EXTENDS: NapiResolveOptions = {
  conditionNames: ['node', 'import'],
  extensions: ['.json'],
  mainFiles: ['tsconfig'],
};

/** The configuration one `extends` entry names, as a key of the parsed set, or nothing. */
type Extended = (config: string, specifier: string) => string | undefined;

/**
 * Every `extends` entry answered as a configuration this read holds.
 *
 * A relative path is placed against the configuration that wrote it. A package
 * name, or a `#` import of the nearest manifest, goes to `oxc-resolver` from
 * that configuration's directory, and its answer is a real path — the link
 * `node_modules/@org/tsconfig` comes back as `packages/tsconfig` — so it is
 * taken against the real root, which may itself sit behind a link (`/tmp` on
 * macOS). One resolver serves every entry, so a manifest or a directory it has
 * read for one configuration is not read again for the next.
 *
 * An absolute path names one machine's disk rather than the repository, and a
 * root with no real path cannot place what the resolver answers; both leave the
 * entry unanswered, as does any other path that starts with a dot.
 */
function extendedIn(root: string, parsed: ReadonlyMap<string, unknown>): Extended {
  let resolver: ResolverFactory | undefined;
  let real: string | null | undefined;
  const answers = new Map<string, string | undefined>();
  const realRoot = (): string | null => {
    if (real === undefined) {
      try {
        real = realpathSync(root);
      } catch {
        real = null;
      }
    }
    return real;
  };

  return (config, specifier) => {
    const from = dirname(config);
    if (specifier.startsWith('./') || specifier.startsWith('../')) {
      const at = normalize(join(from, specifier));
      return parsed.has(at) ? at : parsed.has(`${at}.json`) ? `${at}.json` : undefined;
    }
    if (specifier === '' || specifier.startsWith('.') || specifier.startsWith('/')) return undefined;

    const key = `${from}\u0000${specifier}`;
    if (answers.has(key)) return answers.get(key);
    const anchor = realRoot();
    resolver ??= new ResolverFactory(EXTENDS);
    const found = anchor === null ? undefined : resolver.sync(join(root, from), specifier).path;
    const tracked = found === undefined || anchor === null
      ? undefined
      : relative(anchor, found).split(sep).join('/');
    const answer = tracked !== undefined && parsed.has(tracked) ? tracked : undefined;
    answers.set(key, answer);
    return answer;
  };
}

/**
 * One configuration's options, with everything it extends already folded in.
 *
 * An `extends` entry that is not answered as a configuration the tree tracks
 * abandons the chain rather than guessing at what the base declares.
 */
function compilerOptions(
  path: string,
  parsed: ReadonlyMap<string, Record<string, unknown>>,
  extended: Extended,
  seen: ReadonlySet<string> = new Set(),
): Options | undefined {
  if (seen.has(path)) return { values: {}, from: new Map() };
  const config = parsed.get(path);
  if (config === undefined) return undefined;
  const own = (config['compilerOptions'] ?? {}) as Record<string, unknown>;

  const named = config['extends'];
  const from = named === undefined ? [] : Array.isArray(named) ? named : [named];
  let values: Record<string, unknown> = {};
  const declaredIn = new Map<string, string>();
  for (const one of from) {
    const resolved = typeof one === 'string' ? extended(path, one) : undefined;
    if (resolved === undefined) return undefined;
    const base = compilerOptions(resolved, parsed, extended, new Set([...seen, path]));
    if (base === undefined) return undefined;
    values = { ...values, ...base.values };
    for (const [key, where] of base.from) declaredIn.set(key, where);
  }

  // `paths` and `baseUrl` are read together, so an inherited `paths` under an
  // overridden `baseUrl` has to be the overriding file's answer, which is what
  // spreading in this order gives.
  for (const key of Object.keys(own)) declaredIn.set(key, path);

  return { values: { ...values, ...own }, from: declaredIn };
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

/**
 * A configuration file's JSON, with the comments and trailing commas the
 * TypeScript family permits and `JSON.parse` does not.
 */
async function readConfig(path: string): Promise<Record<string, unknown> | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
  return parseConfig(text);
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
