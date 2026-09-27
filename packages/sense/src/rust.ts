/**
 * What a Rust file asks for and what it publishes.
 *
 * Rust is the language that proves the registry rather than extending it,
 * because nothing about how it finds a file looks like JavaScript or like
 * Python. There is no specifier that names a path. There is a *module tree*,
 * declared statement by statement, and a set of paths that follow from it.
 *
 * ## Two statements, two certainties
 *
 * `mod order;` is a declaration: it says a module named `order` exists as a
 * file, and if the file is missing the crate does not compile. So it is written
 * fact, and a `mod` that resolves to nothing is a **hole** — the same hole a
 * broken relative import is in every other language here.
 *
 * `use crate::read::harvest::Harvest;` is not. It names an *item*, and which
 * prefix of it is the module and which suffix is the thing inside that module is
 * a fact about the disk. `Harvest` may be a type in `read/harvest.rs`, or
 * `harvest` may itself be the type and `read.rs` the module. The reader cannot
 * tell, so every `use` is marked {@link Request.guessed} and resolution takes the
 * longest prefix that is a file. A `use` that finds nothing is an external crate
 * — which is the common case, not an error — and silence is the honest answer.
 *
 * That split is what keeps the two from poisoning each other. Inline modules
 * (`mod tests { … }`) declare no file at all, and if `use` were written-certain
 * every `use super::*` inside one would be reported as a missing file.
 *
 * ## `#[path]` names a file directly
 *
 * The one place Rust does spell a path. It is emitted as written, and the two
 * encodings are told apart by a character a Rust path cannot hold: a module path
 * is `::`-joined identifiers, so anything carrying `.` or `/` is a filename.
 *
 * ## What is unknown
 *
 * A parse error **where an import could have been**, and a missing grammar. A
 * grammar recovers from syntax it cannot read by wrapping it in an `ERROR` node
 * and carrying on, so one unreadable expression inside one function body costs
 * nothing: every import in the file is still there to be read. Marking the file
 * unknown over that would report a single unsupported form — one the grammar is
 * simply a version behind on — as imports nobody could read, when every one of
 * them was. An error hides an import
 * only when it sits where this reader looks — the top level and the body of an
 * inline `mod`, which is everywhere a `use` or a `mod` can be.
 *
 * Nothing else: `include!` and the module paths a macro expands to are invisible
 * here, and are the reason the Rust answer is a floor rather than a total.
 */

import type { TreeWorld } from './world.js';

/** What a crate's source sits under, by universal convention and by Cargo. */
const SOURCE = 'src';

/** The files that are a module without naming one: a crate root, or a directory's own. */
const ROOT_FILES = ['lib.rs', 'main.rs', 'mod.rs'];

/** Whether a Rust request names a file this repository is answerable for. */
export function isRustRelative(request: string): boolean {
  if (spelledPath(request)) return true;
  const first = request.split('::')[0];
  return first === 'self' || first === 'super' || first === 'crate';
}

function spelledPath(request: string): boolean {
  return request.includes('/') || request.includes('.');
}

/**
 * Where a Rust path lands, or nothing.
 *
 * At most one file: unlike Java or Swift, a Rust module is exactly one file, and
 * the many-answer shape the other languages need is unused here.
 */
export function resolveRust(input: {
  readonly from: string;
  readonly request: string;
  readonly world: TreeWorld;
}): readonly string[] {
  const { from, request, world } = input;

  const directory = moduleDirectory(from);
  if (spelledPath(request)) {
    const at = normalize(`${directory}/${request}`);
    return at !== undefined && world.has(at) ? [at] : [];
  }

  const crates = crateIndex(world);
  const here = crateOf(from, crates.roots);
  const written = request.split('::').filter((segment) => segment !== '');
  if (written.length === 0) return [];

  let base: string;
  let rest: readonly string[];

  switch (written[0]) {
    case 'crate': {
      if (here === undefined) return [];
      base = sourceOf(here);
      rest = written.slice(1);
      break;
    }
    case 'self': {
      base = directory;
      rest = written.slice(1);
      break;
    }
    case 'super': {
      let up = directory;
      let at = 0;
      while (written[at] === 'super') {
        const cut = up.lastIndexOf('/');
        if (cut === -1) return [];
        up = up.slice(0, cut);
        at += 1;
      }
      base = up;
      rest = written.slice(at);
      break;
    }
    default: {
      // A crate name. The crate's own name reaches its own files too: Rust
      // allows `use my_crate::x` from inside `my_crate`.
      const root = crates.byName.get(written[0]!);
      if (root === undefined) return [];
      base = sourceOf(root);
      rest = written.slice(1);
    }
  }

  // The longest prefix that is a file. Everything shorter is a module the
  // longer one sits inside, and everything longer is an item inside a file.
  for (let depth = rest.length; depth > 0; depth -= 1) {
    const at = [base, ...rest.slice(0, depth - 1)].join('/');
    const leaf = rest[depth - 1]!;
    for (const candidate of [`${at}/${leaf}.rs`, `${at}/${leaf}/mod.rs`]) {
      const path = normalize(candidate);
      if (path !== undefined && world.has(path)) return [path];
    }
  }

  // Nothing but the base was named — `use crate::Thing`, an item at the root.
  for (const name of ROOT_FILES) {
    const path = normalize(`${base}/${name}`);
    if (path !== undefined && world.has(path)) return [path];
  }
  return [];
}

/**
 * The directory a file's child modules live in.
 *
 * `src/a/mod.rs` and `src/lib.rs` are the module *of* their directory, so their
 * children sit beside them. Every other file owns a directory named after it,
 * which is the 2018-edition layout and the only one in use.
 */
function moduleDirectory(file: string): string {
  const cut = file.lastIndexOf('/');
  const directory = cut === -1 ? '' : file.slice(0, cut);
  const name = file.slice(cut + 1);
  return ROOT_FILES.includes(name) ? directory : `${directory}/${name.replace(/\.rs$/, '')}`;
}

interface Crates {
  /** Crate directories, longest first, so the nearest ancestor is found first. */
  readonly roots: readonly string[];
  /** Crate name as `use` spells it → the crate's directory. */
  readonly byName: ReadonlyMap<string, string>;
}

function crateIndex(world: TreeWorld): Crates {
  return world.index('rust:crates', (tree) => {
    const roots: string[] = [];
    const byName = new Map<string, string>();

    for (const path of tree.below('')) {
      if (path !== 'Cargo.toml' && !path.endsWith('/Cargo.toml')) continue;
      const directory = path.slice(0, Math.max(0, path.length - 'Cargo.toml'.length - 1));
      roots.push(directory);
      // The manifest name when the manifest can be read, and the directory name
      // otherwise — a world built from a bare list of paths has no bytes. Both
      // are normalised the way Cargo does: a hyphen in a manifest is an
      // underscore in every `use` that names it.
      const declared = manifestName(tree.text(path));
      const name = (declared ?? directory.slice(directory.lastIndexOf('/') + 1)).replace(/-/g, '_');
      if (name !== '') byName.set(name, directory);
    }

    return { roots: roots.sort((a, b) => b.length - a.length), byName };
  });
}

function manifestName(text: string | undefined): string | undefined {
  if (text === undefined) return undefined;
  // `[package]` only. A `[workspace]` table has no name, and a `name` under
  // `[dependencies]` or `[[bin]]` is not this crate's.
  const table = /^\s*\[package\]\s*$/m.exec(text);
  if (table === null) return undefined;
  const after = text.slice(table.index + table[0].length);
  const next = /^\s*\[/m.exec(after);
  const body = next === null ? after : after.slice(0, next.index);
  return /^\s*name\s*=\s*["']([^"']+)["']/m.exec(body)?.[1];
}

function crateOf(file: string, roots: readonly string[]): string | undefined {
  return roots.find((root) => (root === '' ? true : file.startsWith(`${root}/`)));
}

function sourceOf(crate: string): string {
  return crate === '' ? SOURCE : `${crate}/${SOURCE}`;
}

/** A path with `..` and `.` taken out, or nothing when it climbs above the root. */
function normalize(path: string): string | undefined {
  const parts: string[] = [];
  for (const part of path.split('/')) {
    if (part === '' || part === '.') continue;
    if (part !== '..') {
      parts.push(part);
      continue;
    }
    if (parts.length === 0) return undefined;
    parts.pop();
  }
  return parts.join('/');
}
