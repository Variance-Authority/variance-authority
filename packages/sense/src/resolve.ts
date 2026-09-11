/**
 * A specifier, as written, into a file on this disk.
 *
 * This is the configured half of a scan and the reason it is a separate file:
 * `tsconfig` paths, export conditions, extension order and the partial
 * conventions of Sass all live here, and none of them is allowed to change what
 * counts as an import. [`read.ts`](./read.ts) decides that from syntax alone;
 * this only decides where the thing it found points.
 *
 * ## What it refuses to answer
 *
 * Everything outside the repository. A builtin, a package in `node_modules`, a
 * path above the root — all three come back as nothing, because nothing in a diff
 * of this repository can be that file and an edge to it could never carry a
 * change.
 *
 * ## The case-folding problem
 *
 * macOS and Windows match filenames without regard to case, so a specifier can
 * resolve to a file it does not name. Two of the functions here exist only for
 * that, and both are invisible on the case-sensitive machine most CI runs on —
 * which is exactly why they are written down rather than discovered.
 */

import { realpathSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, relative, sep } from 'node:path';
import { ResolverFactory } from 'oxc-resolver';
import type { EdgeKind } from '@variance-authority/core/relate';
import { MODULE_EXTENSIONS, STYLE_EXTENSIONS } from './read.js';

/** What a caller may say about resolution, and nothing about what to scan. */
export interface ResolveOptions {
  /**
   * A `tsconfig.json` whose `paths` resolution applies. `'auto'` discovers the
   * nearest one per file, which is what a workspace of many packages needs.
   */
  readonly tsconfig?: string | 'auto';
  /** Export conditions, in order. Defaults to a source-first, browser bias. */
  readonly conditionNames?: readonly string[];
}

/** Source before built output: a package that publishes both is worth more as source. */
export const DEFAULT_CONDITIONS = ['source', 'import', 'require', 'default'] as const;

/** Directories a scan never descends into, and never records a file inside. */
export const EXCLUDE_DIRS = ['node_modules', 'dist', 'build', 'coverage', '.git', '.next', '.turbo'];

/**
 * The three resolvers a scan needs, plus the memo they share.
 *
 * Three because one set of options cannot answer all three questions: a
 * stylesheet request must not find a `.ts` file, and a request that only resolved
 * because `.js` was rewritten to `.ts` has to be re-asked without the rewrite.
 */
export interface Resolvers {
  /** Modules first, with the `.js` → `.ts` rewrite on. */
  readonly modules: ResolverFactory;
  /** Stylesheet extensions only. */
  readonly styles: ResolverFactory;
  /** No extension rewriting, for the one request where the rewrite is the bug. */
  readonly exact: ResolverFactory;
  /** Resolved path → its spelling on disk, memoised for the scan. */
  readonly canonical: Map<string, string>;
}

export function resolversFor(options: ResolveOptions): Resolvers {
  const tsconfig = options.tsconfig ?? 'auto';

  const modules = new ResolverFactory({
    extensions: [...MODULE_EXTENSIONS, ...STYLE_EXTENSIONS, '.json'],
    conditionNames: [...(options.conditionNames ?? DEFAULT_CONDITIONS)],
    mainFields: ['source', 'module', 'main'],
    // A TypeScript file under `nodenext` imports `./graph.js` and means
    // `./graph.ts`. Without this the extension on disk never matches, every
    // relative specifier fails, and — because a failed relative specifier
    // widens — a repository written the modern way scans to an entirely opaque
    // graph: no error, no edges, and every run a whole run.
    extensionAlias: {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
      '.cjs': ['.cts', '.cjs'],
    },
    tsconfig: tsconfig === 'auto' ? 'auto' : { configFile: tsconfig, references: 'auto' },
    // Real paths, so a workspace symlink lands on the package's own directory
    // and its files are repository files like any other.
    symlinks: true,
    builtinModules: true,
  });

  return {
    modules,
    styles: modules.cloneWithOptions({ extensions: [...STYLE_EXTENSIONS] }),
    exact: modules.cloneWithOptions({ extensionAlias: {} }),
    canonical: new Map(),
  };
}

export interface Request {
  readonly resolvers: Resolvers;
  /** Repository root. The answer is relative to it, or there is no answer. */
  readonly root: string;
  /** The absolute path of the file the specifier was written in. */
  readonly from: string;
  /** The specifier, already reduced to something resolvable by `requestOf`. */
  readonly request: string;
  /** Whether the importing file is a stylesheet. */
  readonly style: boolean;
}

/**
 * Where a specifier points, repository-relative, or nothing.
 *
 * Nothing covers three situations a caller does not need to tell apart: a
 * builtin, a package outside the repository, and a specifier no resolution
 * reached. None of them can be in a diff of this repository.
 */
export function resolveTo(input: Request): string | undefined {
  const { resolvers, root, from, request, style } = input;
  const directory = dirname(from);

  const attempts = style ? styleRequests(request) : [request];
  const order = style
    ? [resolvers.styles, resolvers.modules]
    : [resolvers.modules, resolvers.exact];

  for (const resolver of order) {
    for (const attempt of attempts) {
      let result;
      try {
        result = resolver.sync(directory, attempt);
      } catch {
        continue;
      }
      if (result.path === undefined || result.builtin !== undefined) continue;

      const path = onDisk(resolvers.canonical, result.path);
      if (caseFolded(attempt, path)) continue;

      const file = toRepoPath(root, path);
      if (file !== undefined) return file;
    }
  }

  return undefined;
}

/**
 * Whether a resolution only succeeded because the filesystem ignores case.
 *
 * macOS and Windows match filenames without regard to case, so `./legacy.js` in a
 * directory holding `Legacy.tsx` resolves to `Legacy.tsx` — the file doing the
 * importing. The edge is a self-loop, the real `legacy.js` is left with no
 * dependents, and a change to it reaches nothing. Rejecting the fold sends the
 * request to a resolver that will not rewrite the extension, which finds the file
 * that was actually named.
 *
 * Only an *equal-but-for-case* stem counts. `./colors` finding `_colors.scss` and
 * `react` finding `index.js` are different names, resolved on purpose.
 */
function caseFolded(request: string, resolved: string): boolean {
  const asked = stemOf(basename(request));
  const found = stemOf(basename(resolved));

  return asked !== found && asked.toLowerCase() === found.toLowerCase();
}

function stemOf(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? name : name.slice(0, dot);
}

/**
 * A resolved path as the filesystem actually spells it.
 *
 * macOS and Windows match filenames without regard to case, so `./legacy.js`
 * beside a `Legacy.tsx` resolves — to `legacy.tsx`, a path no directory listing
 * will ever produce. Recording it as written puts *two* nodes in the graph for one
 * file on disk, and the importer hangs off the phantom: a diff naming
 * `Legacy.tsx` then reaches nobody. That is the one failure this whole structure
 * is built to refuse, and it is invisible on a case-sensitive CI machine where the
 * specifier simply would not have resolved.
 *
 * Memoised because a scan resolves the same handful of shared modules from every
 * file in the repository, and this is a syscall.
 */
function onDisk(canonical: Map<string, string>, path: string): string {
  const known = canonical.get(path);
  if (known !== undefined) return known;

  const real = realPath(path);
  canonical.set(path, real);

  return real;
}

/**
 * The forms one stylesheet specifier can take.
 *
 * Sass resolves `./colors` to `_colors.scss`, and the partial convention is a
 * naming rule rather than a resolution option, so it is tried as a second
 * request. The leading `~` of the webpack era means "from `node_modules`", which
 * is the plain bare specifier here.
 */
function styleRequests(request: string): readonly string[] {
  const bare = request.startsWith('~') ? request.slice(1) : request;
  const cut = bare.lastIndexOf('/');
  const partial = `${bare.slice(0, cut + 1)}_${bare.slice(cut + 1)}`;

  return bare === request ? [bare, partial] : [bare, partial, request];
}

/**
 * A specifier as a resolvable request, or nothing when it cannot be one.
 *
 * Query and fragment suffixes are a build-tool convention — `?raw`, `?url`,
 * `?inline` — and they name the same file with different handling. Stripping
 * them is what keeps a perfectly ordinary asset import from being reported as an
 * unresolvable hole and widening the run.
 */
export function requestOf(value: string): string | undefined {
  const trimmed = value.trim();
  if (trimmed === '' || trimmed.startsWith('data:') || trimmed.startsWith('node:')) return undefined;

  const cut = Math.min(indexOr(trimmed, '?'), indexOr(trimmed, '#'));
  const bare = trimmed.slice(0, cut);

  return bare === '' ? undefined : bare;
}

function indexOr(value: string, mark: string): number {
  const at = value.indexOf(mark);
  return at === -1 ? value.length : at;
}

/** Whether a request names a path in this repository rather than a package. */
export function isRelative(request: string): boolean {
  return request.startsWith('./') || request.startsWith('../') || request === '.' || request === '..';
}

/**
 * The edge kind, once the target is known.
 *
 * A specifier's *syntax* says how it was written; its *target* says what it is.
 * `import './button.css'` is written as an import and is an asset, and the
 * difference is what lets a caller ask for a traversal through code only.
 * A type import stays a type import whatever it points at — nothing it names
 * survives compilation.
 */
export function kindFor(kind: EdgeKind, target: string): EdgeKind {
  if (kind === 'type') return 'type';

  return MODULE_EXTENSIONS.includes(extname(target)) ? kind : 'asset';
}

/**
 * A path with every symlink followed and every name spelled as the disk spells
 * it, or the path itself when it is not there.
 *
 * The native call rather than the JavaScript one, because only the native one
 * corrects case on the two platforms that need it corrected.
 */
export function realPath(path: string): string {
  try {
    return realpathSync.native(path);
  } catch {
    return path;
  }
}

/** A path inside the repository, relative and slash-separated, or nothing. */
export function toRepoPath(root: string, absolute: string): string | undefined {
  const path = relative(root, absolute);
  if (path === '' || path.startsWith('..') || isAbsolute(path)) return undefined;

  const normalized = sep === '/' ? path : path.split(sep).join('/');

  return normalized.split('/').some((part) => EXCLUDE_DIRS.includes(part)) ? undefined : normalized;
}
