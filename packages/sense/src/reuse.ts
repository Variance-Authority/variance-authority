/**
 * A whole record — edges included — kept from the last run, and the one fact that
 * makes keeping it sound.
 *
 * [`cache.ts`](./cache.ts) remembers what a file's *bytes* said, which is
 * cacheable forever because it depends on nothing else. An **edge** is not: where
 * `./button.css` points depends on the directory the specifier sits in, on which
 * files exist around it, on `tsconfig` paths and on what is installed. So a scan
 * with a hot parse cache still opens no files and still spends all its time in the
 * resolver, asking the same questions about a repository that did not move.
 *
 * A record is a function of exactly four things:
 *
 * | | named by |
 * | --- | --- |
 * | the file's bytes | its content digest |
 * | where the file sits | its path, which is the key |
 * | how resolution is configured | the config digest |
 * | which paths could have answered it | its witnesses |
 *
 * The first two a scan already has. The config digest names the manifests, lock
 * files and `tsconfig` contents every resolution in the repository reads, so a
 * change to one of them rebuilds everything and says so. The witnesses name the
 * directories that particular file's specifiers looked in
 * ([`witness.ts`](./witness.ts)), so a change to one of *them* rebuilds the
 * records that were looking.
 *
 * ## What a path appearing costs
 *
 * The directory it appeared in, and nothing else. Adding a component under
 * `packages/panel/src` moves one directory, and the records rebuilt are the ones
 * whose specifiers name that directory — its neighbours, and whoever imports
 * into it. A repository taking a hundred pull requests an hour moves a hundred
 * directories an hour and keeps the rest of its index, which is the property the
 * previous rule did not have: it digested the whole path set, so one added file
 * invalidated every record in the repository.
 *
 * ## Where it gives up
 *
 * A bare specifier is bounded by the `paths` a `tsconfig` declares, and a
 * configuration that cannot be read is no bound at all. When
 * [`aliasesIn`](./witness.ts) comes back empty-handed the whole path set goes
 * into the config digest instead, which is the old rule, applied on purpose and
 * only where nothing better is available.
 *
 * ## What this does not cover
 *
 * Files git cannot see. The tree is built from the digest map, which comes from
 * the object database, so a generated file appearing under a `.gitignore` moves
 * no directory. Such a file can never appear in a diff and so can never carry a
 * change — but it can, in principle, shadow a resolution. That is the one gap, it
 * is bounded by `git add`, and `digests: false` turns the whole mechanism off.
 */

import { existsSync, readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { digestBytes } from './digest.js';
import { digestString, type Digest } from '@variance-authority/core/format';
import { DEFAULT_CONDITIONS, type ResolveOptions } from './resolve.js';
import { isNamed, treeOf, type Tree } from './tree.js';
import { aliasesIn, type Aliases } from './witness.js';

/**
 * What decides a record besides the files: how specifiers resolve, and the
 * size past which a file is declined. A declined record names the bytes it
 * declined, so a raised limit has to move the digest or it would keep them.
 */
export type ShapeOptions = ResolveOptions & { readonly largestFile?: number; readonly packs?: boolean };

/** The tree as reuse sees it: one digest for the configuration, one per directory. */
export interface TreeShape {
  /** How resolution is configured, and — when aliases are unknown — every path. */
  readonly config: Digest;
  /** Every directory in the tree, named by the entries it holds. */
  readonly directories: ReadonlyMap<string, Digest>;
}

/** Bumped when what a `FileRecord` holds or the config inputs change, so record keys move. */
const VERSION = 11;

/**
 * Files whose *contents* decide where other files resolve to.
 *
 * A path list alone would miss an edit to `tsconfig.json` that redirects every
 * `@/` specifier in the repository, or a lockfile change that swaps which copy of
 * a package a bare specifier lands on.
 */
const LAYOUT_FILES = [
  'package.json',
  'jsconfig.json',
  'yarn.lock',
  'package-lock.json',
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'bun.lockb',
  'deno.json',
];

/** Whether a file's contents decide where other files' imports resolve: a manifest, a lockfile, a workspace or `tsconfig*.json`. */
export function decidesResolution(path: string): boolean {
  return isNamed(path, LAYOUT_FILES);
}

/**
 * The tree as two questions: how resolution is configured, and what each
 * directory holds.
 *
 * The scanned directories are deliberately in neither. They decide which records
 * a scan produces, never what any one record contains, so a narrower run can
 * reuse a wider run's work and neither invalidates the other.
 */
export async function treeShapeOf(input: {
  readonly root: string;
  readonly digests: ReadonlyMap<string, Digest>;
  readonly options?: ShapeOptions;
}): Promise<{ readonly shape: TreeShape; readonly aliases: Aliases | undefined }> {
  const { digests, ...rest } = input;

  return shapeOf({ ...rest, tree: treeOf(digests) });
}

/**
 * The same two questions, asked of a tree rather than of a map.
 *
 * Every line below is a fold over the repository's paths, and on a tree the size
 * of a monorepo the folding is the cost — so it is the tree that folds, and the
 * listing stays wherever it already is ([`tree.ts`](./tree.ts)).
 */
export async function shapeOf(input: {
  readonly root: string;
  readonly tree: Tree;
  readonly options?: ShapeOptions;
}): Promise<{ readonly shape: TreeShape; readonly aliases: Aliases | undefined }> {
  const { config, aliases } = await configOf(input);
  return { shape: { config, directories: input.tree.directories() }, aliases };
}

/**
 * The shape a scan of a directory git cannot list keeps its records under.
 * Nothing names a file's bytes before it is read there, so no record is reused
 * and the shape need only differ from every listed one: a scan git lists
 * clears the records kept under it, as it would another configuration's.
 */
export async function unlistedShapeOf(input: { readonly root: string; readonly options?: ShapeOptions }): Promise<TreeShape> {
  const { config } = await configOf({ ...input, tree: treeOf(new Map()) });
  return { config: digestString(`not listed by git\n${config}`), directories: new Map() };
}

/**
 * How the digest names a `tsconfig` setting: `auto`, `off`, or the file from the
 * checkout's root and its contents, so a worktree laid out alike adopts the
 * primary checkout's records under a config the root config names.
 */
function tsconfigNamed(root: string, tsconfig: string | false | undefined): string {
  if (tsconfig === undefined || tsconfig === 'auto') return 'auto';
  if (tsconfig === false) return 'off';
  const file = isAbsolute(tsconfig) ? tsconfig : resolve(root, tsconfig);
  // Its contents too: the config digest holds only the `tsconfig*.json` files
  // the listing holds, and a named one may be ignored or named otherwise.
  const contents = existsSync(file) ? digestBytes(readFileSync(file)) : 'absent';
  return `file ${relative(root, file).split(sep).join('/')} ${contents}`;
}

/**
 * The configuration half of {@link shapeOf}: the digest and the aliases,
 * without the directory digests, which the addon's update derives from its own
 * listing and a caller that hands it only the digest would build for nothing.
 */
export async function configOf(input: {
  readonly root: string;
  readonly tree: Tree;
  readonly options?: ShapeOptions;
}): Promise<{ readonly config: Digest; readonly aliases: Aliases | undefined }> {
  const { root, tree, options } = input;
  // `aliasesIn` reads configuration files, so it wants the configuration files —
  // which is the same question the config digest asks, minus the manifests.
  const aliases = await aliasesIn(root, tree.named(['jsconfig.json']), options?.packs === false ? undefined : tree.native);

  // No `root`: a record names files relative to the checkout it was scanned
  // from and holds no absolute path, so a worktree adopts the primary
  // checkout's records wherever the two are laid out alike.
  const header = [
    `version ${VERSION}`,
    `tsconfig ${tsconfigNamed(root, options?.tsconfig)}`,
    // Unnamed conditions add each governing `tsconfig`'s `customConditions`,
    // whose contents the config digest already holds; named ones are the whole
    // set, and no `tsconfig` moves them.
    options?.conditionNames === undefined
      ? `conditions ${DEFAULT_CONDITIONS.join(',')} + tsconfig customConditions`
      : `conditions ${options.conditionNames.join(',')}`,
    // Named only when a caller names it, so every run at the default keeps
    // the digest it had before a limit was part of it.
    ...(options?.largestFile === undefined ? [] : [`largest ${options.largestFile}`]),
  ];

  return {
    // No bound on where a bare specifier could land means no bound on what a
    // new path could change, and the honest expression of that is the old rule.
    config: tree.configDigest(header, LAYOUT_FILES, aliases === undefined),
    aliases,
  };
}
