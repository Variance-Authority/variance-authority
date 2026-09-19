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

import { isBuiltin } from 'node:module';
import { realpathSync } from 'node:fs';
import { basename, extname, isAbsolute, relative, sep } from 'node:path';
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
export const EXCLUDE_DIRS = [
  'node_modules',
  'dist',
  'tsDist',
  'build',
  'coverage',
  'storybook-static',
  '.git',
  '.next',
  '.turbo',
];

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
  /** Resolved path → where it landed, memoised for the scan. */
  readonly canonical: Map<string, Landing>;
  /** The root the repository paths in `canonical` were worked out against. */
  against: string | undefined;
  /** What the file currently being resolved has already asked. */
  readonly asking: Asking;
}

/**
 * Where one resolved path landed: how the disk spells it, and where that sits.
 *
 * The two travel together because they are one answer about one path, and
 * because the second is the expensive one to repeat. A 200,000-file tree draws
 * **1,210,225 edges to 202,226 distinct files**, so a repository path worked out
 * at each edge is 1.2 million `relative` calls and 1.2 million strings for two
 * hundred thousand distinct values. Worked out once per landing it is two
 * hundred thousand of each. Measured on that tree: **five to six seconds off a
 * forty-second scan**, producing the same 1,210,225 edges.
 *
 * It saves time and **no memory at all**, which is worth writing down because
 * the obvious reason to expect otherwise is wrong. The live heap of a finished
 * scan is 163.3 MiB with this memo and 163.3 MiB without it, to the tenth of a
 * mebibyte, because the edge targets were already shared before anything here
 * interned them: [`scan.ts`](./scan.ts) asks `built.has(edge.to)` for every
 * edge, and a string used as a map key is internalized by V8 — the duplicate
 * becomes a pointer to the one canonical copy. Interning a string the engine is
 * about to intern buys nothing.
 */
export interface Landing {
  /** The path as the filesystem spells it — symlinks followed, case as stored. */
  readonly disk: string;
  /** That path inside the repository, or nothing when it is outside. */
  readonly file: string | undefined;
}

/**
 * One file's resolutions, and which file they belong to.
 *
 * Resolution is a question about the importing *file*. A solution-style
 * `tsconfig` picks the project that governs a file by matching it against each
 * reference's `include` and `exclude`, so `src/widget.ts` and
 * `src/widget.test.ts` can answer to configs whose `paths` disagree — and
 * whichever the scan reached first would answer for the other. So the file is
 * part of what an answer is keyed by, and that is not negotiable.
 *
 * It is also the *whole* reach of the memo, which is why the memo is this shape
 * rather than one map for the run. Scanning material-ui's `packages/` asks
 * 86,304 times and 86,222 of those are distinct: the memo answers eighty-two,
 * and every one of the eighty-two is one file naming one specifier twice —
 * imported for its value and again for its type, re-exported beside the import,
 * or simply written twice. An entry for a file the scan has finished with can
 * never be read again, so a map for the run is a map of dead answers.
 *
 * Measured on a 200,000-file tree making 1,210,225 requests, all distinct: held
 * for the run those answers are **619.5 MiB** of peak resident memory (1,819.0
 * against 1,199.5) and save nothing, because a repeat across two files is not a
 * thing that exists. Held for one file they are a few entries. The key is
 * unchanged — the file is still in it, as the enclosing object rather than as a
 * prefix — so no answer is shared that was not shared before.
 *
 * `null` is a resolution that failed, remembered because failure is the
 * expensive answer: a bare specifier that is not in this repository walks the
 * whole `node_modules` chain to the root before it comes back with nothing.
 * Within one file, `react` written ten times is nine walks saved.
 */
export interface Asking {
  /** The file every answer is about. Nothing until the first question. */
  file: string | undefined;
  /** `style`-and-specifier → where it landed, or `null` for nowhere. */
  readonly answers: Map<string, string | null>;
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
    against: undefined,
    asking: { file: undefined, answers: new Map() },
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

  // The importing file, not its directory. Under project references the config
  // that governs a file is chosen by matching the file against each referenced
  // project's `include` and `exclude`, so the two halves of a `src/` directory
  // can sit under `paths` that disagree — and a directory key would hand one
  // half the other's answer, silently, by scan order.
  //
  // The file is the memo rather than a prefix of its keys. A caller that has
  // moved on to another file can never read these answers again, so they are
  // dropped where they stop being answers ([`Asking`](#asking)) instead of being
  // carried to the end of a scan that is a million of them.
  const { asking } = resolvers;
  if (asking.file !== from) {
    asking.file = from;
    asking.answers.clear();
  }

  const key = `${style ? 's' : 'm'}\0${request}`;
  const known = asking.answers.get(key);
  if (known !== undefined) return known ?? undefined;

  const answer = resolved({ resolvers, root, from, request, style });
  asking.answers.set(key, answer ?? null);
  return answer;
}

function resolved(input: {
  readonly resolvers: Resolvers;
  readonly root: string;
  readonly from: string;
  readonly request: string;
  readonly style: boolean;
}): string | undefined {
  const { resolvers, root, from, request, style } = input;

  const attempts = style ? styleRequests(request) : [request];
  const order = style
    ? [resolvers.styles, resolvers.modules]
    : [resolvers.modules, resolvers.exact];

  for (const resolver of order) {
    for (const attempt of attempts) {
      let result;
      try {
        // The importing **file**, not its directory. `tsconfig: 'auto'` means
        // "find the config by walking up from here", and only the file-taking
        // entry points do that walk — handed a directory, the resolver silently
        // behaves as though no `tsconfig` were configured at all, which drops
        // every `paths` alias in the repository and reports nothing.
        result = resolver.resolveFileSync(from, attempt);
      } catch {
        continue;
      }
      if (result.path === undefined || result.builtin !== undefined) continue;

      const { disk, file } = landed(resolvers, root, result.path);
      if (caseFolded(attempt, disk)) continue;

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
 * A resolved path as the filesystem spells it, and where that is in the tree.
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
 * file in the repository: the spelling is a syscall, and the repository path is a
 * string the whole edge list would otherwise hold a separate copy of
 * ([`Landing`](#Landing)).
 *
 * The root is checked rather than assumed. A repository path is only an answer
 * relative to the root it was measured from, and one `Resolvers` outliving a
 * change of root would otherwise hand back paths belonging to the old one.
 * Nothing in this package does that today; the guard costs a comparison per
 * landing and removes the question.
 */
function landed(resolvers: Resolvers, root: string, path: string): Landing {
  const { canonical } = resolvers;
  if (resolvers.against !== root) {
    resolvers.against = root;
    canonical.clear();
  }

  const known = canonical.get(path);
  if (known !== undefined) return known;

  const disk = realPath(path);
  const landing: Landing = { disk, file: toRepoPath(root, disk) };
  canonical.set(path, landing);

  return landing;
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
 * The package a specifier asks for, or nothing when it asks for no package.
 *
 * A relative path, an absolute one, a URL and a Node builtin are all excluded,
 * and what is left is a bare specifier — whose package is its first segment, or
 * its first two when it is scoped. `@mui/material/Button` is `@mui/material`,
 * because that is the name an install resolves and the name a lockfile moves.
 *
 * Nothing here checks whether the package exists. It cannot: the reason a bare
 * specifier reaches this function at all is that resolution declined to place
 * it, which under pnpm's store or Yarn PnP is the ordinary case rather than a
 * failure. A name is enough, and asking for more would make the answer depend
 * on whose machine ran the scan.
 */
export function packageOf(request: string): string | undefined {
  if (isRelative(request) || request.startsWith('/') || request.includes('://')) return undefined;
  if (isBuiltin(request)) return undefined;

  const parts = request.split('/');
  const name = request.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0]!;

  // `@scope` on its own is not a package, and neither is the empty string a
  // specifier like `/` leaves behind.
  return name === '' || (name.startsWith('@') && !name.includes('/')) ? undefined : name;
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
