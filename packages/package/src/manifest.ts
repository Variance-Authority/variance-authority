import { existsSync, globSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { type ImportTargets, importTargets, isPublished, legacyEntry } from './entry.js';
import { subpathsOf } from './exports.js';
import { members } from './members.js';

export { publishes, requested } from './exports.js';

/**
 * What a workspace publishes, read from the manifests rather than from a build.
 *
 * A `package.json` is the thing npm uploads and the thing another project reads.
 * Everything else — a `dist` directory, an emitted `.d.ts`, a bundle — is
 * something a build produced from it, true of one checkout at one moment. So the
 * `exports` map is the authority on which subpaths exist, and the source behind
 * each one is found by undoing the mapping the manifest points through, not by
 * reading what the mapping produced.
 */

/**
 * What a manifest says about the shape of what it publishes.
 *
 * Where the code is, which subpath opens what, what lands in the tarball, what
 * ends up on a `PATH`. Everything is recorded present-or-absent, so a package
 * that *starts* declaring `engines` or `sideEffects` is a change rather than a
 * silence.
 *
 * Dependencies are deliberately absent, peers included. A dependency graph is a
 * different subject with different questions — which range, which duplicate,
 * which transitive licence — and tools exist that answer them. This reads what a
 * package *offers*, not what it *needs*. `version` is absent for a duller
 * reason: it moves every release and would drown the signal.
 */
export const OFFERED: readonly string[] = [
  'type',
  'main',
  'types',
  'exports',
  'files',
  'bin',
  'engines',
  'sideEffects',
];

/** One subpath an `exports` map opens, and the source file behind it. */
export interface Entrypoint {
  readonly subpath: string;
  readonly source: string;
}

/** A published package, as its own manifest declares it. */
export interface Offering {
  readonly name: string;
  readonly dir: string;
  readonly declared: Readonly<Record<string, unknown>>;
  readonly entrypoints: readonly Entrypoint[];
  /** Published subpaths whose source could not be established. */
  readonly unreadable?: readonly string[];
}

export interface OfferingOptions {
  /** Manifest keys to record. Defaults to {@link OFFERED}. */
  readonly offered?: readonly string[];
  /** Record an unreadable opening and continue. Strict when absent. */
  readonly tolerant?: boolean;
}

/**
 * A manifest or a tsconfig, as the object it holds; a `package.yaml` member is
 * YAML. A tsconfig is JSONC whatever it is named, so a config an `extends`
 * chain reaches — Kibana's `tsconfig.base.json` — is read as `tsconfig: true`.
 */
function read(path: string, tsconfig = path.endsWith('tsconfig.json')): Record<string, unknown> {
  const source = readFileSync(path, 'utf8');
  const yaml = path.endsWith('.yaml');
  try {
    const held: unknown = yaml ? parseYaml(source) : JSON.parse(tsconfig ? jsonc(source) : source);
    return (held ?? {}) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${path} is not readable ${yaml ? 'YAML' : 'JSON'}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Remove JSONC comments and trailing commas without touching string contents. */
function jsonc(source: string): string {
  let plain = '';
  let string = false;
  let escaped = false;
  for (let at = 0; at < source.length; at += 1) {
    const char = source[at]!;
    const next = source[at + 1];
    if (string) {
      plain += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') string = false;
    } else if (char === '"') {
      string = true;
      plain += char;
    } else if (char === '/' && next === '/') {
      while (at + 1 < source.length && source[at + 1] !== '\n') at += 1;
    } else if (char === '/' && next === '*') {
      at += 2;
      while (at < source.length && !(source[at] === '*' && source[at + 1] === '/')) at += 1;
      at += 1;
    } else {
      plain += char;
    }
  }

  let cleaned = '';
  string = false;
  escaped = false;
  for (let at = 0; at < plain.length; at += 1) {
    const char = plain[at]!;
    if (string) {
      cleaned += char;
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') string = false;
      continue;
    }
    if (char === '"') string = true;
    if (char === ',') {
      let next = at + 1;
      while (/\s/.test(plain[next] ?? '')) next += 1;
      if (plain[next] === '}' || plain[next] === ']') continue;
    }
    cleaned += char;
  }
  return cleaned;
}

/**
 * Which package a repository-relative file belongs to.
 *
 * The nearest manifest above it, which is what makes a file in an example
 * directory that example's rather than the repository's — and what makes a
 * fixture workspace nested inside a package's tests belong to the fixture, which
 * is the only reading under which a count of it means anything.
 *
 * Asked per directory and memoized, rather than built by traversing the tree:
 * the caller that wants this already knows every file, and walking the
 * repository again to attribute files it is holding is the one cost worth not
 * paying. A package with two hundred files asks once.
 *
 * `''` when nothing above the file is named, including the root.
 */
export function ownership(root: string): (at: string) => string {
  const where = resolve(root);
  const known = new Map<string, string>();

  const nameAt = (dir: string): string => {
    const held = known.get(dir);
    if (held !== undefined) return held;

    const manifest = join(where, dir, 'package.json');
    const name = existsSync(manifest) ? read(manifest)['name'] : undefined;
    const found =
      typeof name === 'string'
        ? name
        : dir === ''
          ? ''
          : nameAt(dir.slice(0, Math.max(0, dir.lastIndexOf('/'))));

    known.set(dir, found);
    return found;
  };

  return (at) => nameAt(at.slice(0, Math.max(0, at.lastIndexOf('/'))));
}

/**
 * The source file a published `types` target was compiled from.
 *
 * Three attempts, in the order that trusts the manifest most. A target that
 * already *is* source needs nothing undone. A target under a `tsconfig.json`'s
 * `outDir` is mapped back through its `rootDir`, `.d.ts` to `.ts` — and to
 * `.tsx`, because a component entrypoint is a normal thing to publish. Anything
 * else is an error naming what was tried, never a silently skipped entrypoint.
 */
function sourceOf(dir: string, types: string): string {
  const emitted = join(dir, types);
  if (!types.endsWith('.d.ts') && existsSync(emitted)) return emitted;

  const config = join(dir, 'tsconfig.json');
  if (!existsSync(config)) {
    throw new Error(`\`${types}\` is not a source file, and \`${config}\` is not there to say what produced it`);
  }

  const { compilerOptions } = read(config) as {
    compilerOptions?: { rootDir?: string; outDir?: string };
  };
  const outDir = compilerOptions?.outDir;
  const rootDir = compilerOptions?.rootDir;
  if (outDir === undefined || rootDir === undefined) {
    if (existsSync(emitted)) return emitted;
    throw new Error(`\`${config}\` declares no \`rootDir\`/\`outDir\` pair, so \`${types}\` cannot be mapped back`);
  }

  const out = posix.normalize(`${outDir}/`);
  const target = posix.normalize(types);
  if (!target.startsWith(out)) {
    if (existsSync(emitted)) return emitted;
    throw new Error(`\`${types}\` is not under this package's outDir \`${outDir}\``);
  }

  const stem = join(dir, posix.normalize(`${rootDir}/`), target.slice(out.length).replace(/\.d\.ts$/, ''));
  for (const extension of ['.ts', '.tsx']) {
    if (existsSync(`${stem}${extension}`)) return `${stem}${extension}`;
  }
  if (existsSync(emitted)) return emitted;
  throw new Error(`\`${types}\` maps to \`${stem}.ts\`, which is not there`);
}

/**
 * Where a subpath's condition says its declarations are, or `undefined` when it
 * names none.
 *
 * `types` is the answer wherever a manifest writes it, and one level down inside
 * `import` or `require` is where most manifests write it — the shape every
 * tooling guide prints. Read only at the top level, a package that had said
 * exactly where its declarations were opened nothing at all.
 *
 * A bare string is the other common shape, and it carries declarations exactly
 * when it is TypeScript. `"./src/index.ts"` is the source itself, which is what
 * a repository that publishes its own source writes; `"./jest-resolver.cjs"` is
 * a file with no declarations behind it, which is the case this returns
 * `undefined` for and the reason the check is on the extension rather than on
 * the shape.
 */
function declarationsOf(condition: unknown): string | undefined {
  if (typeof condition === 'string') {
    return /\.(ts|tsx|mts|cts)$/.test(condition) ? condition : undefined;
  }
  if (typeof condition !== 'object' || condition === null || Array.isArray(condition)) return undefined;

  const declared = (condition as { types?: unknown }).types;
  if (typeof declared === 'string') return declared;

  for (const nested of Object.values(condition)) {
    const found = declarationsOf(nested);
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * The declaration file written beside a bare JavaScript export, or `undefined`
 * when there is none.
 *
 * `"./src/index.js"` with `src/index.d.ts` next to it is how a package whose
 * source is JavaScript publishes hand-written types, and the sibling is what
 * TypeScript itself resolves that path to. It is authored, not emitted, so it is
 * the source: nothing is mapped back through a tsconfig. A wildcard is returned
 * as a pattern and the glob in {@link openedBy} keeps only the files that exist.
 * With no declaration beside it, the TypeScript source of the same stem —
 * `src/index.ts`, then `src/index.tsx` — is the file TypeScript resolves a `.js`
 * path to, which is how a package whose `main` names the file its source compiles
 * to is read without a build.
 *
 * Only for JavaScript that is source. Under the package's `outDir` the file
 * beside it was emitted, and exists only when the build ran; an answer read
 * from it would change with whether somebody had built.
 */
// FIXME: a package with no tsconfig `outDir` that builds into `dist` beside a
// bare `./dist/index.js` export opens the emitted `dist/index.d.ts` whenever a
// build has run, so the answer changes with whether somebody built. Open the
// sibling only when the repository tracks it; a condition object with no
// `types` is not read this way at all.
function besideOf(dir: string, condition: unknown): string | undefined {
  if (typeof condition !== 'string') return undefined;
  const found = /\.(m|c)?js$/.exec(condition);
  if (found === null || emittedInto(dir, condition)) return undefined;
  const stem = condition.slice(0, found.index);
  const declaration = `${stem}.d.${found[1] ?? ''}ts`;
  if (declaration.includes('*')) return declaration;
  const sources = found[1] === undefined ? [`${stem}.ts`, `${stem}.tsx`] : [`${stem}.${found[1]}ts`];
  return [declaration, ...sources].find((candidate) => existsSync(join(dir, candidate)));
}

/** Whether `target` sits under the `outDir` the package's own tsconfig declares. */
function emittedInto(dir: string, target: string): boolean {
  const config = join(dir, 'tsconfig.json');
  if (!existsSync(config)) return false;
  const outDir = (read(config) as { compilerOptions?: { outDir?: unknown } }).compilerOptions?.outDir;
  return typeof outDir === 'string' && posix.normalize(target).startsWith(posix.normalize(`${outDir}/`));
}

const EMITTED_AS: Readonly<Record<string, string>> = { ts: 'js', tsx: 'js', mts: 'mjs', cts: 'cjs' };

/**
 * The subpaths a pattern whose target ends in its wildcard opens in source.
 *
 * `"./v4/locales/*": { "@zod/source": "./src/v4/locales/*" }` leaves the
 * extension to the specifier, so a consumer writes `zod/v4/locales/fr.js` and
 * TypeScript opens `src/v4/locales/fr.ts` for it. Each TypeScript source file
 * the pattern matches is one subpath, spelt with the extension it is emitted
 * as. A pattern that matches no source, such as `./dist/*` in a checkout that
 * was never built, opens nothing.
 */
function namedWithExtension(dir: string, subpath: string, condition: unknown): readonly Entrypoint[] {
  if (typeof condition !== 'string' || !condition.endsWith('*') || !subpath.endsWith('*')) return [];
  if ((condition.match(/\*/g)?.length ?? 0) !== 1 || (subpath.match(/\*/g)?.length ?? 0) !== 1) return [];
  const before = condition.replace(/^\.\//, '').slice(0, -1);
  return globSync(`${before}*.{ts,tsx,mts,cts}`, { cwd: dir })
    .filter((matched) => !/\.d\.[mc]?ts$/.test(matched))
    .sort()
    .map((matched) => {
      const found = /\.(ts|tsx|mts|cts)$/.exec(matched)!;
      const capture = `${matched.slice(before.length, found.index)}.${EMITTED_AS[found[1]!]}`;
      return { subpath: subpath.replace('*', capture), source: join(dir, matched) };
    });
}

function openedBy(dir: string, subpath: string, types: string): readonly Entrypoint[] {
  if (!types.includes('*')) return [{ subpath, source: sourceOf(dir, types) }];
  if ((types.match(/\*/g)?.length ?? 0) !== 1 || (subpath.match(/\*/g)?.length ?? 0) !== 1) {
    throw new Error(`export pattern \`${subpath}\` -> \`${types}\` must contain one wildcard on each side`);
  }
  if (!/\.(ts|tsx|mts|cts)$/.test(types)) {
    throw new Error(`export pattern \`${types}\` is not source and cannot be mapped without built files`);
  }

  const normalized = types.replace(/^\.\//, '');
  const [before = '', after = ''] = normalized.split('*');
  return globSync(normalized, { cwd: dir })
    .sort()
    .map((matched) => {
      const capture = matched.slice(before.length, matched.length - after.length);
      return { subpath: subpath.replace('*', capture), source: join(dir, matched) };
    });
}

/**
 * The export conditions the package's own `tsconfig.json` adds:
 * `compilerOptions.customConditions`, through its `extends` chain.
 *
 * A workspace that exports source under a condition of its own — Zod's
 * `"@zod/source": "./src/index.ts"`, TanStack's `"@tanstack/custom-condition"` —
 * says so to TypeScript here, and TypeScript owns what that specifier means
 * inside the repository. The nearest config that sets the option wins, and
 * `null` or `[]` clears it, as `tsc` reads it.
 */
function customConditionsOf(dir: string): ReadonlySet<string> {
  const chain = (path: string, seen: ReadonlySet<string>): readonly string[] | undefined => {
    if (seen.has(path)) return undefined;
    const config = read(path, true) as { extends?: unknown; compilerOptions?: { customConditions?: unknown } };
    const own = config.compilerOptions?.customConditions;
    if (own !== undefined) {
      return Array.isArray(own) ? own.filter((value): value is string => typeof value === 'string') : [];
    }
    const bases = typeof config.extends === 'string' ? [config.extends] : Array.isArray(config.extends) ? config.extends : [];
    for (const base of [...bases].reverse()) {
      const found = typeof base === 'string' ? extendedFile(dirname(path), base) : undefined;
      const inherited = found === undefined ? undefined : chain(found, new Set([...seen, path]));
      if (inherited !== undefined) return inherited;
    }
    return undefined;
  };
  const config = join(dir, 'tsconfig.json');
  return new Set(existsSync(config) ? (chain(config, new Set()) ?? []) : []);
}

/** The config an `extends` entry names: a path, or a package under a `node_modules` above. */
function extendedFile(directory: string, specifier: string): string | undefined {
  const isFile = (path: string) => statSync(path, { throwIfNoEntry: false })?.isFile() === true;
  const candidates = (at: string) => [at, `${at}.json`, join(at, 'tsconfig.json')];
  if (specifier.startsWith('.') || specifier.startsWith('/')) {
    return candidates(resolve(directory, specifier)).find(isFile);
  }
  for (let at = directory; ; at = dirname(at)) {
    const found = candidates(join(at, 'node_modules', specifier)).find(isFile);
    if (found !== undefined) return found;
    if (dirname(at) === at) return undefined;
  }
}

/**
 * The branch of a condition TypeScript takes under the `custom` conditions.
 *
 * Keys are read in the order the manifest writes them, as Node and TypeScript
 * read them: the first custom condition is taken unless `types` comes before
 * it. An array of fallbacks is its first entry that names something to open.
 * With no custom condition the condition is returned as written, and
 * {@link declarationsOf} finds its declarations.
 */
function followed(dir: string, condition: unknown, custom: ReadonlySet<string>): unknown {
  if (Array.isArray(condition)) {
    return condition
      .map((entry) => followed(dir, entry, custom))
      .find((entry) => besideOf(dir, entry) !== undefined || declarationsOf(entry) !== undefined);
  }
  if (typeof condition !== 'object' || condition === null) return condition;
  for (const [key, value] of Object.entries(condition)) {
    if (key === 'types') return condition;
    if (custom.has(key)) return followed(dir, value, custom);
  }
  return condition;
}

/** The workspace packages an import between packages is followed into, as {@link importTargets} reads them. */
export function readImportTargets(root: string): ImportTargets {
  return importTargets(members(resolve(root), read).map((path) => read(path)));
}

/**
 * Every published package of a workspace, and the source each entrypoint opens.
 *
 * `private: true` is the only filter, and it is the manifest's own word for *do
 * not publish this*. A subpath whose condition names no declarations — see
 * {@link declarationsOf} — is recorded under `declared` and not opened: a package
 * may publish a file it has no declarations for, and pretending otherwise would
 * either invent a source or drop the subpath.
 */
export function readOfferings(root: string, options: OfferingOptions = {}): readonly Offering[] {
  const offered = options.offered ?? OFFERED;
  const found: Offering[] = [];

  for (const path of members(resolve(root), read)) {
    const manifest = read(path);
    if (!isPublished(manifest)) continue;

    const dir = dirname(path);
    const declared: Record<string, unknown> = {};
    for (const key of offered) if (manifest[key] !== undefined) declared[key] = manifest[key];

    const entrypoints: Entrypoint[] = [];
    const unreadable: string[] = [];
    let subpaths: readonly (readonly [string, unknown])[] = [];
    try {
      subpaths = manifest['exports'] === undefined ? legacyEntry(manifest) : subpathsOf(path, manifest['exports']);
    } catch (error) {
      if (options.tolerant !== true) throw error;
      unreadable.push(`${manifest['name']} — ${error instanceof Error ? error.message : String(error)}`);
    }
    const custom = customConditionsOf(dir);
    for (const [subpath, written] of subpaths) {
      const condition = followed(dir, written, custom);
      const authored = besideOf(dir, condition);
      if (authored !== undefined && !authored.includes('*')) {
        entrypoints.push({ subpath, source: join(dir, authored) });
        continue;
      }
      const types = authored ?? declarationsOf(condition);
      if (types === undefined) {
        entrypoints.push(...namedWithExtension(dir, subpath, condition));
        continue;
      }
      try {
        entrypoints.push(...openedBy(dir, subpath, types));
      } catch (error) {
        if (options.tolerant !== true) throw error;
        unreadable.push(`${manifest['name']} ${subpath} — ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    found.push({
      name: manifest['name'],
      dir,
      declared,
      entrypoints,
      ...(unreadable.length === 0 ? {} : { unreadable }),
    });
  }

  return found;
}
