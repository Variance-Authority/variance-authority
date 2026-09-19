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
 * tracked path can change it. What can is a `tsconfig` that maps it: `@app/*`
 * pointing at `src/*` makes `@app/button` exactly as sensitive to `src` as
 * `./button` is to its own directory. So the patterns are read from the
 * `tsconfig` and `jsconfig` files the tree holds, and a request that matches one
 * gets the substituted paths as candidates.
 *
 * When a configuration cannot be read — invalid JSON, or an `extends` naming a
 * package rather than a path — there is no honest bound on where a bare
 * specifier could land. Aliases are then **unknown**, and the caller that asks
 * for them is expected to fall back to treating the whole path set as one
 * witness ([`reuse.ts`](./reuse.ts)).
 */

import { readFile } from 'node:fs/promises';
import { dirname, join, normalize } from 'node:path/posix';
import { basename } from 'node:path';
import { digestString, type Digest } from './digest.js';
import { isRelative, requestOf } from './specifier.js';

/** Where a non-relative specifier could land, lexically. */
export interface Aliases {
  /** Every repo-relative path this request could name through a configuration. */
  candidatesFor(request: string): readonly string[];
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

interface Mapping {
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

  const mappings: Mapping[] = [];
  const bases = new Set<string>();
  const already = new Set<string>();
  for (const path of configs) {
    const options = compilerOptions(path, parsed);
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
    for (const [pattern, targets] of Object.entries(declared as Record<string, unknown>)) {
      if (!Array.isArray(targets)) return undefined;
      const placed = targets
        .filter((target): target is string => typeof target === 'string')
        .map((target) => within(join(base, target)))
        .filter((target): target is string => target !== undefined);
      // One root read through forty configs that extend it is one mapping.
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
 * One configuration's options, with everything it extends already folded in.
 *
 * An `extends` naming a package is a file this function cannot open — it lives
 * in `node_modules`, which the tree does not hold — so the chain is abandoned
 * rather than guessed at.
 */
function compilerOptions(
  path: string,
  parsed: ReadonlyMap<string, Record<string, unknown>>,
  seen: ReadonlySet<string> = new Set(),
): Options | undefined {
  if (seen.has(path)) return { values: {}, from: new Map() };
  const config = parsed.get(path);
  if (config === undefined) return undefined;
  const own = (config['compilerOptions'] ?? {}) as Record<string, unknown>;

  const extended = config['extends'];
  const from = extended === undefined ? [] : Array.isArray(extended) ? extended : [extended];
  let values: Record<string, unknown> = {};
  const declaredIn = new Map<string, string>();
  for (const one of from) {
    if (typeof one !== 'string' || !(one.startsWith('./') || one.startsWith('../'))) return undefined;
    const at = normalize(join(dirname(path), one));
    const resolved = parsed.has(at) ? at : parsed.has(`${at}.json`) ? `${at}.json` : undefined;
    if (resolved === undefined) return undefined;
    const base = compilerOptions(resolved, parsed, new Set([...seen, path]));
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
  try {
    const value: unknown = JSON.parse(stripComments(text).replace(/,(\s*[}\]])/gu, '$1'));
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
