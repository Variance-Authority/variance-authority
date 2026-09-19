/**
 * The tree itself, as the languages that resolve against it need to see it.
 *
 * `oxc-resolver` answers for JavaScript by walking the disk: a specifier goes in,
 * `node_modules` chains and `package.json` conditions are consulted, a path comes
 * out. None of the other languages resolve that way. Python looks for a file
 * under a list of source roots; Rust walks a module tree rooted at a crate file;
 * Java and Kotlin turn a dotted package into a directory and read what is in it;
 * Swift turns a module name into a whole directory of files. What they have in
 * common is not an algorithm — it is a *question about the tree*, and the scan
 * already knows the whole tree before the first specifier is asked.
 *
 * So this is the shared half: does this path exist, what is directly inside this
 * directory, what is anywhere below it. Asked of a set the scan already holds,
 * each is a lookup rather than a syscall, which matters at the scale where it
 * matters: a Python namespace package spread over nineteen roots asks the first
 * question seventy-six times per specifier, and a Swift `import` asks the third
 * once per file against a target of several hundred.
 *
 * ## Why an index lives here and not in the language
 *
 * A language needs more than the three questions — Python needs its source
 * roots, Rust its crate roots, Swift its module directories — and every one of
 * those is a walk over all the paths. Computed per file they are quadratic;
 * computed per scan they are free. [`index`](#index) is where a language parks
 * that walk, keyed by a name of its own choosing, and the world holds it for
 * exactly as long as the scan does. Nothing here knows what any of them mean.
 *
 * ## Two worlds, one shape
 *
 * [`worldIn`](#worldIn) is handed the paths a scan already walked.
 * [`worldOn`](#worldOn) walks the disk itself, once, lazily, for the callers
 * that resolve without having scanned — the taint join and the tests. They are
 * the same object afterwards, because a resolution must not depend on which of
 * them the caller happened to build.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import { EXCLUDE_DIRS } from './resolve.js';

/** What every language-specific resolver is allowed to ask about the tree. */
export interface TreeWorld {
  /** Whether the tree holds this repository-relative path. */
  has(path: string): boolean;
  /**
   * Every file directly inside a directory, repository-relative and sorted.
   *
   * Directly: `a/b.java` for `a`, never `a/c/d.java`. This is the grain a Java
   * or Kotlin package is, and the reason it is separate from `below`.
   */
  under(directory: string): readonly string[];
  /** Every file at any depth below a directory, repository-relative and sorted. */
  below(directory: string): readonly string[];
  /**
   * The contents of one small file, when this world is over a real directory.
   *
   * The narrow exception to a world being about paths alone, and it exists for
   * one thing: a Cargo manifest's `name` is the only place a crate's name is
   * written, and a crate name is what `use other_crate::x` resolves through.
   * Nothing is the answer for a world built from a bare list of paths, and every
   * caller has to have a weaker answer ready for that — a scan must not resolve
   * differently in a test than it does on disk.
   */
  text(path: string): string | undefined;
  /**
   * A language's own index over the tree, computed at most once per world.
   *
   * The key is the language's to choose and is never interpreted here. `make`
   * is called with the world so an index may be built out of the other three
   * questions, and is never called again for the same key.
   */
  index<T>(key: string, make: (world: TreeWorld) => T): T;
}

/**
 * A world over the paths a scan has already walked.
 *
 * `root` is the directory those paths are relative to, and is what makes
 * {@link TreeWorld.text} answerable. Without it the paths are all this world
 * has, which is the shape a test builds and a scan never does.
 */
export function worldIn(paths: Iterable<string>, root?: string): TreeWorld {
  const sorted = [...new Set(paths)].sort(byCodeUnit);
  return worldOver(() => sorted, root);
}

/**
 * A world over a directory on disk, walked once when something first asks.
 *
 * Lazy because a caller may build one and never resolve a specifier in a
 * language that needs it — every JavaScript-only scan does — and the walk is
 * the whole tree.
 */
export function worldOn(root: string): TreeWorld {
  let walked: readonly string[] | undefined;
  return worldOver(() => (walked ??= walk(root)), root);
}

function worldOver(paths: () => readonly string[], root: string | undefined): TreeWorld {
  let held: ReadonlySet<string> | undefined;
  const indexes = new Map<string, unknown>();
  const texts = new Map<string, string | undefined>();

  const world: TreeWorld = {
    has: (path) => (held ??= new Set(paths())).has(path),
    text: (path) => {
      if (root === undefined) return undefined;
      if (!texts.has(path)) texts.set(path, readText(join(root, path)));
      return texts.get(path);
    },
    below: (directory) => range(paths(), directory),
    under: (directory) => {
      const depth = directory === '' ? 0 : directory.split('/').length;
      return range(paths(), directory).filter((path) => path.split('/').length === depth + 1);
    },
    index: <T>(key: string, make: (world: TreeWorld) => T): T => {
      if (!indexes.has(key)) indexes.set(key, make(world));
      return indexes.get(key) as T;
    },
  };

  return world;
}

/**
 * The contiguous run of paths under a directory, found by two binary searches.
 *
 * Contiguous because the paths are sorted by code unit and every path under
 * `a/b` starts with `a/b/`, so they sit together between the first string that
 * is not less than `a/b/` and the first that is not less than `a/b0` — `0`
 * being the next code unit after `/`. A filter over the whole tree would be the
 * same answer at a hundred thousand string comparisons per question, asked once
 * per Swift import.
 */
function range(sorted: readonly string[], directory: string): readonly string[] {
  if (directory === '') return sorted;
  const prefix = `${directory}/`;
  const from = lowerBound(sorted, prefix);
  const to = lowerBound(sorted, `${directory}0`);
  return sorted.slice(from, to);
}

function lowerBound(sorted: readonly string[], value: string): number {
  let low = 0;
  let high = sorted.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (sorted[middle]! < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

function readText(absolute: string): string | undefined {
  try {
    return readFileSync(absolute, 'utf8');
  } catch {
    return undefined;
  }
}

function walk(root: string): readonly string[] {
  const found: string[] = [];
  const skip = new Set(EXCLUDE_DIRS);

  const descend = (directory: string): void => {
    let entries;
    try {
      entries = readdirSync(join(root, directory), { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const path = directory === '' ? entry.name : `${directory}/${entry.name}`;
      if (entry.isDirectory()) {
        if (!skip.has(entry.name)) descend(path);
      } else if (entry.isFile()) {
        found.push(path);
      }
    }
  };

  descend('');
  return found.sort(byCodeUnit);
}

/** A repository-relative path, in the spelling a world is keyed by. */
export function repoPathOf(root: string, absolute: string): string {
  return absolute.startsWith(root + sep)
    ? absolute.slice(root.length + 1).split(sep).join('/')
    : absolute.split(sep).join('/');
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
