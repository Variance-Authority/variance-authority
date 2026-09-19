import { existsSync, globSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';

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
 * A specifier as the pair a manifest can answer.
 *
 * `@variance-authority/core/plan` is a package and a subpath, and only the
 * package half has a manifest to ask. Written as one string because that is what
 * a lookup key wants and because the space cannot occur in either half.
 */
export function requested(specifier: string): string {
  const parts = specifier.split('/');
  const name = specifier.startsWith('@') ? parts.slice(0, 2).join('/') : (parts[0] ?? specifier);
  return `${name} .${specifier.slice(name.length)}`;
}

function read(path: string): Record<string, unknown> {
  const source = readFileSync(path, 'utf8');
  try {
    return JSON.parse(path.endsWith('tsconfig.json') ? jsonc(source) : source) as Record<string, unknown>;
  } catch (error) {
    throw new Error(`${path} is not readable JSON: ${error instanceof Error ? error.message : String(error)}`);
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
 * Every manifest the root's `workspaces` field reaches.
 *
 * Only a literal path and a trailing `/*` are understood, because those are what
 * a workspace field almost always holds and a half-implemented glob that quietly
 * matches the wrong set is worse than one that says it cannot. A repository with
 * no `workspaces` at all is one package, and that is the interesting case for
 * anybody who is not a monorepo.
 *
 * A repository with no root manifest publishes nothing, and that is an answer
 * rather than an error. Plenty of checkouts are not npm projects at all — a
 * Swift application with a landing page under it, a service with a web client in
 * a subdirectory — and the question *where is the thing that does X* is asked of
 * those more often than of a monorepo. Nothing is published there, so nothing is
 * on the published half of an answer, and everything the source exports is still
 * read.
 */
function members(root: string): readonly string[] {
  if (!existsSync(join(root, 'package.json'))) return [];

  const { workspaces } = read(join(root, 'package.json'));
  const globs = Array.isArray(workspaces)
    ? (workspaces as string[])
    : (((workspaces as { packages?: string[] } | undefined)?.packages ?? []) as string[]);

  if (globs.length === 0) return [join(root, 'package.json')];

  const found: string[] = [];
  for (const glob of globs) {
    if (!glob.includes('*')) {
      const manifest = join(root, glob, 'package.json');
      if (existsSync(manifest)) found.push(manifest);
      continue;
    }

    if (!glob.endsWith('/*')) {
      throw new Error(`workspace glob \`${glob}\` is neither a path nor \`dir/*\`, which is all this reads`);
    }

    const parent = join(root, glob.slice(0, -2));
    if (!existsSync(parent)) continue;
    for (const name of readdirSync(parent).sort()) {
      const manifest = join(parent, name, 'package.json');
      if (existsSync(manifest)) found.push(manifest);
    }
  }
  return found;
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

  for (const path of members(resolve(root))) {
    const manifest = read(path);
    if (manifest['private'] === true || typeof manifest['name'] !== 'string') continue;

    const dir = dirname(path);
    const declared: Record<string, unknown> = {};
    for (const key of offered) if (manifest[key] !== undefined) declared[key] = manifest[key];

    const entrypoints: Entrypoint[] = [];
    const unreadable: string[] = [];
    const exports = (manifest['exports'] ?? {}) as Record<string, unknown>;
    for (const [subpath, condition] of Object.entries(exports)) {
      const types = declarationsOf(condition);
      if (types === undefined) continue;
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
