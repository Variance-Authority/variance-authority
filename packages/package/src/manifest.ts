import { existsSync, readFileSync, readdirSync } from 'node:fs';
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
}

export interface OfferingOptions {
  /** Manifest keys to record. Defaults to {@link OFFERED}. */
  readonly offered?: readonly string[];
}

function read(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

/**
 * Every manifest the root's `workspaces` field reaches.
 *
 * Only a literal path and a trailing `/*` are understood, because those are what
 * a workspace field almost always holds and a half-implemented glob that quietly
 * matches the wrong set is worse than one that says it cannot. A repository with
 * no `workspaces` at all is one package, and that is the interesting case for
 * anybody who is not a monorepo.
 */
function members(root: string): readonly string[] {
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
    throw new Error(`\`${config}\` declares no \`rootDir\`/\`outDir\` pair, so \`${types}\` cannot be mapped back`);
  }

  const out = posix.normalize(`${outDir}/`);
  const target = posix.normalize(types);
  if (!target.startsWith(out)) {
    throw new Error(`\`${types}\` is not under this package's outDir \`${outDir}\``);
  }

  const stem = join(dir, posix.normalize(`${rootDir}/`), target.slice(out.length).replace(/\.d\.ts$/, ''));
  for (const extension of ['.ts', '.tsx']) {
    if (existsSync(`${stem}${extension}`)) return `${stem}${extension}`;
  }
  throw new Error(`\`${types}\` maps to \`${stem}.ts\`, which is not there`);
}

/**
 * Every published package of a workspace, and the source each entrypoint opens.
 *
 * `private: true` is the only filter, and it is the manifest's own word for *do
 * not publish this*. A subpath with no `types` condition is recorded under
 * `declared` and not opened: a package may publish a file it has no declarations
 * for, and pretending otherwise would either invent a source or drop the subpath.
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
    const exports = (manifest['exports'] ?? {}) as Record<string, unknown>;
    for (const [subpath, condition] of Object.entries(exports)) {
      const types =
        typeof condition === 'object' && condition !== null
          ? (condition as { types?: unknown }).types
          : undefined;
      if (typeof types !== 'string') continue;
      entrypoints.push({ subpath, source: sourceOf(dir, types) });
    }

    found.push({ name: manifest['name'], dir, declared, entrypoints });
  }

  return found;
}
