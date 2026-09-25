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
import { basename, isAbsolute, relative, sep } from 'node:path';
import { ResolverFactory, type NapiResolveOptions } from 'oxc-resolver';
import { customConditionsFor } from './conditions.js';
import { resolveJvm } from './jvm.js';
import type { LanguageId } from './language.js';
import { resolvePython } from './python.js';
import { MODULE_EXTENSIONS } from './read.js';
import { STYLE_EXTENSIONS, styleRequests } from './style.js';
import { resolveRust } from './rust.js';
import { resolveSwift } from './swift.js';
import type { TreeWorld } from './world.js';

/** What a caller may say about resolution, and nothing about what to scan. */
export interface ResolveOptions {
  /**
   * A `tsconfig.json` whose `paths` resolution applies. `'auto'` discovers the
   * nearest one per file, which is what a workspace of many packages needs.
   */
  readonly tsconfig?: string | 'auto';
  /**
   * Export conditions, and the whole of them. Absent, a file resolves under
   * {@link DEFAULT_CONDITIONS} plus the `customConditions` of the `tsconfig`
   * that governs it.
   */
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
  /** Modules first, with the `.js` → `.ts` rewrite on, under the default conditions. */
  readonly modules: ResolverFactory;
  /**
   * The module resolver for a request written in `from`: `modules`, or a clone
   * of it that adds the `customConditions` of the `tsconfig` governing `from`
   * ([`conditions.ts`](./conditions.ts)). Conditions a caller named are the
   * answer, and then this is always `modules`.
   */
  readonly modulesFor: (from: string) => ResolverFactory;
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
  /**
   * The tree itself, once a scan has walked it ([`world.ts`](./world.ts)).
   *
   * Nothing to do with `oxc-resolver`, which is why it sits beside the three
   * rather than among them. Every language after JavaScript resolves by asking
   * about the tree rather than by walking the disk: Python has no `node_modules`
   * chain and no manifest to consult per request, Rust has a module tree, and
   * Java, Kotlin and Swift turn a name into a directory. The scan already holds
   * the answer for the whole tree — so asking it costs a map lookup where a
   * `stat` would cost a syscall, seventy-six times per specifier on a namespace
   * package spread across nineteen roots.
   *
   * Absent until a caller names a tree, and a request in one of those languages
   * asked before then resolves to nothing rather than to a guess.
   */
  tree: TreeWorld | undefined;
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
  /**
   * Language-and-specifier → where it landed, or `null` for nowhere.
   *
   * The language is in the key and not merely along for the ride: the same
   * string asked from two languages is two questions, and `./colors` is the
   * standing example — from a stylesheet it may land on `_colors.scss`, from a
   * module it must not.
   */
  readonly answers: Map<string, readonly string[]>;
}

export function resolversFor(options: ResolveOptions): Resolvers {
  const tsconfig = options.tsconfig ?? 'auto';

  const defaults = [...(options.conditionNames ?? DEFAULT_CONDITIONS)];
  // Held whole, because `cloneWithOptions` replaces options rather than merging
  // them: a condition set is a clone built from every option below.
  const moduleOptions: NapiResolveOptions = {
    extensions: [...MODULE_EXTENSIONS, ...STYLE_EXTENSIONS, '.json'],
    conditionNames: defaults,
    mainFields: ['source', 'module', 'main'],
    // A TypeScript file under `nodenext` imports `./graph.js` and means
    // `./graph.ts`. Without this the extension on disk never matches, every
    // relative specifier fails, and — because a failed relative specifier is a
    // missing edge — a repository written the modern way scans to a graph with
    // every file unknown and no edges, and no error says so.
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
  };
  const modules = new ResolverFactory(moduleOptions);

  return {
    modules,
    modulesFor: options.conditionNames === undefined
      ? conditioned(modules, moduleOptions, customConditionsFor(tsconfig))
      : () => modules,
    styles: modules.cloneWithOptions({ extensions: [...STYLE_EXTENSIONS] }),
    exact: modules.cloneWithOptions({ extensionAlias: {} }),
    canonical: new Map(),
    against: undefined,
    asking: { file: undefined, answers: new Map() },
    tree: undefined,
  };
}

/**
 * `modulesFor` over one factory: a file's custom conditions select a clone that
 * adds them, and files whose configs agree share it. Asked once per file, since
 * `resolveAll` asks a file's requests together.
 */
function conditioned(
  modules: ResolverFactory,
  moduleOptions: NapiResolveOptions,
  customOf: (file: string) => readonly string[],
): (from: string) => ResolverFactory {
  const defaults = moduleOptions.conditionNames ?? [];
  const bySet = new Map<string, ResolverFactory>();
  let last: { from: string; factory: ResolverFactory } | undefined;
  return (from) => {
    if (last?.from === from) return last.factory;
    const names = [...new Set([...defaults, ...customOf(from)])];
    let factory = modules;
    if (names.length > defaults.length) {
      const key = names.join('\0');
      factory = bySet.get(key) ?? modules.cloneWithOptions({ ...moduleOptions, conditionNames: names });
      bySet.set(key, factory);
    }
    last = { from, factory };
    return factory;
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
  /** The language the importing file was read as, which picks the algorithm. */
  readonly language: LanguageId;
}

/**
 * Where a specifier points, repository-relative, or nothing.
 *
 * Nothing covers three situations a caller does not need to tell apart: a
 * builtin, a package outside the repository, and a specifier no resolution
 * reached. None of them can be in a diff of this repository.
 */
export function resolveTo(input: Request): string | undefined {
  return resolveAll(input)[0];
}

/**
 * Every file a specifier reaches, in the order a caller should prefer them.
 *
 * One answer is the JavaScript, stylesheet, Python and Rust shape: a specifier
 * names a file. Java, Kotlin and Swift have no such shape — `import a.b.*` is a
 * package, and `import Core` is a whole Swift target — so the general answer is
 * a list, and the languages that can only ever return one return one.
 */
export function resolveAll(input: Request): readonly string[] {
  const { resolvers, root, from, request, language } = input;

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

  const key = `${language}\0${request}`;
  const known = asking.answers.get(key);
  if (known !== undefined) return known;

  const answer = resolved({ resolvers, root, from, request, language });
  asking.answers.set(key, answer);
  return answer;
}

function resolved(input: {
  readonly resolvers: Resolvers;
  readonly root: string;
  readonly from: string;
  readonly request: string;
  readonly language: LanguageId;
}): readonly string[] {
  const { resolvers, root, from, request, language } = input;

  if (OVER_THE_TREE.has(language)) {
    const world = resolvers.tree;
    const file = toRepoPath(root, from);
    if (world === undefined || file === undefined) return [];
    switch (language) {
      case 'python': return resolvePython({ from: file, request, world });
      case 'rust': return resolveRust({ from: file, request, world });
      case 'swift': return resolveSwift({ from: file, request, world });
      default: return resolveJvm({ from: file, request, world });
    }
  }

  const style = language === 'style';
  const attempts = style ? styleRequests(request) : [request];
  const modules = resolvers.modulesFor(from);
  const order = style
    ? [resolvers.styles, modules]
    : [modules, resolvers.exact];

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

      if (file !== undefined) return [file];
    }
  }

  return [];
}

/**
 * The languages that resolve by asking about the tree rather than walking disk.
 *
 * Everything but JavaScript and stylesheets, which is to say everything added
 * after this package's first shape. They share the one
 * [`TreeWorld`](./world.ts) and differ only in what they ask it.
 */
const OVER_THE_TREE: ReadonlySet<LanguageId> = new Set<LanguageId>([
  'python',
  'rust',
  'java',
  'kotlin',
  'swift',
]);

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
