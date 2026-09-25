/**
 * What a Python file asks for and what it publishes.
 *
 * The same two questions [`read.ts`](./read.ts) asks of a JavaScript module, in
 * a language whose answers are shaped differently in three ways that matter.
 *
 * ## One statement is several modules
 *
 * `from briefcase.platform.answer import diagnose` runs four files: the three
 * package `__init__.py` on the way down, and then either
 * `answer/diagnose.py` — if `diagnose` is a module — or nothing more, if it is a
 * name that `answer/__init__.py` defines. **Which of the two is a fact about the
 * disk, not about the statement**, and the language offers no way to tell them
 * apart by reading.
 *
 * So the reader emits every module path the statement could have meant and marks
 * the ones it derived rather than read as {@link Request.guessed}. A guessed
 * request that resolves is an edge; one that does not is silence — not an
 * unresolved specifier, not a hole, not an `unknown`. Measured over `briefcase`,
 * 299 files and 597 first-party requests: resolving only the written module
 * misses **64 edges**, a tenth of them, and the shape it misses is a test
 * importing three sibling modules from their package. A change to one of those
 * modules would not select that test. That is the failure this package exists to
 * refuse, so the guesses are taken.
 *
 * ## An import executes the packages above it
 *
 * `import a.b.c` runs `a/__init__.py` and `a/b/__init__.py` before `a/b/c.py`,
 * so a change to either reaches every importer. Those are real edges — 246 of
 * them over `briefcase` that nothing else reaches — and they are guessed for a
 * different reason than submodules are: a package directory with no
 * `__init__.py` is a namespace package (PEP 420), which is ordinary and means
 * there is no file to depend on. A prefix that does not resolve is therefore not
 * a hole either.
 *
 * ## `if TYPE_CHECKING:` is `import type`
 *
 * The block is erased before anything runs, exactly as a TypeScript type import
 * is, so it is read as one. The `else:` branch of that same statement is not:
 * it is the runtime half, and marking it type-only would erase a real edge.
 *
 * ## What is unknown
 *
 * A parse error, and a non-literal `importlib.import_module(x)` or `__import__(x)`.
 * A literal one is read and becomes a `dynamic` edge, for the reason the module
 * reader reads a literal `require`: a dynamic corner of a repository that is
 * legible belongs in the graph.
 */

import type { TreeWorld } from './world.js';

/** Files a package is made of, in the order Python looks for them. */
const MODULE_FILES = ['.py', '/__init__.py', '.pyi', '/__init__.pyi'];

/** Manifests whose directory is a source root, and whose `src/` is one too. */
const MANIFESTS = ['pyproject.toml', 'setup.py', 'setup.cfg'];

function leadingDots(value: string): number {
  let dots = 0;
  while (dots < value.length && value[dots] === '.') dots += 1;
  return dots;
}

/**
 * Where Python looks for a top-level module, in the order it looks.
 *
 * A distribution's own directory, and its `src/` when it has one — the layout
 * `briefcase` uses nineteen times over, where one `briefcase` package is spread
 * across nineteen `src/` roots and only their union resolves it. The repository
 * root is last and always present, because a script beside its imports is the
 * layout with no manifest at all.
 */
export function pythonRootsOf(paths: Iterable<string>): readonly string[] {
  const all = [...paths];
  const directories = new Set<string>();
  for (const path of all) {
    const cut = path.lastIndexOf('/');
    directories.add(cut === -1 ? '' : path.slice(0, cut));
  }

  const roots = new Set<string>();
  for (const path of all) {
    const cut = path.lastIndexOf('/');
    if (!MANIFESTS.includes(path.slice(cut + 1))) continue;
    const dir = cut === -1 ? '' : path.slice(0, cut);
    const src = dir === '' ? 'src' : `${dir}/src`;
    // `src/` counts when something is under it, not when it is merely named:
    // an empty one resolves nothing and costs a lookup on every request.
    if ([...directories].some((at) => at === src || at.startsWith(`${src}/`))) roots.add(src);
    roots.add(dir);
  }
  roots.add('');

  return [...roots];
}

/**
 * Where one Python specifier lands, repository-relative, or nothing.
 *
 * `exists` is asked rather than a disk, because the scan already holds the
 * tree's path set and a namespace package spread over nineteen roots turns one
 * specifier into seventy-six candidate paths — which is a memo lookup each, and
 * would be seventy-six `stat` calls otherwise.
 */
export function resolvePython(input: {
  readonly from: string;
  readonly request: string;
  readonly world: TreeWorld;
}): readonly string[] {
  const { from, request, world } = input;
  const exists = (path: string): boolean => world.has(path);
  const roots = pythonRoots(world);
  const dots = leadingDots(request);
  const tail = request.slice(dots).replaceAll('.', '/');

  if (dots > 0) {
    // One dot is this package — the directory the file is in. Each further dot
    // is one package up.
    const parts = from.split('/').slice(0, -1);
    if (dots - 1 > parts.length) return [];
    const base = parts.slice(0, parts.length - (dots - 1)).join('/');
    const landed = found(base === '' ? tail : tail === '' ? base : `${base}/${tail}`, exists);
    return landed === undefined ? [] : [landed];
  }

  for (const root of roots) {
    const landed = found(root === '' ? tail : `${root}/${tail}`, exists);
    if (landed !== undefined) return [landed];
  }

  return [];
}

/** The source roots of this tree, walked once and held for the scan. */
function pythonRoots(world: TreeWorld): readonly string[] {
  return world.index('python:roots', (tree) => pythonRootsOf(tree.below('')));
}

function found(base: string, exists: (path: string) => boolean): string | undefined {
  if (base === '') return undefined;
  for (const end of MODULE_FILES) {
    const candidate = `${base}${end}`;
    if (exists(candidate)) return candidate;
  }
  return undefined;
}

/** Whether a Python specifier names something inside this tree by construction. */
export function isPythonRelative(request: string): boolean {
  return request.startsWith('.');
}
