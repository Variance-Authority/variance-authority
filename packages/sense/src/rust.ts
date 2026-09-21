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
 * nothing: every import in the file is still there to be read. Widening on that
 * would let a single unsupported form — one the grammar is simply a version
 * behind on — pull the whole repository into reach. An error hides an import
 * only when it sits where this reader looks — the top level and the body of an
 * inline `mod`, which is everywhere a `use` or a `mod` can be.
 *
 * Nothing else: `include!` and the module paths a macro expands to are invisible
 * here, and are the reason the Rust answer is a floor rather than a total.
 */

import { missingGrammar, parserFor, type GrammarNode } from './grammar.js';
import type { Export, Read, Request } from './read.js';
import type { TreeWorld } from './world.js';

/** What a crate's source sits under, by universal convention and by Cargo. */
const SOURCE = 'src';

/** The files that are a module without naming one: a crate root, or a directory's own. */
const ROOT_FILES = ['lib.rs', 'main.rs', 'mod.rs'];

export function readRust(file: string, source: string): Read {
  const parser = parserFor('rust');
  if (parser === undefined) {
    return { requests: [], unknown: missingGrammar(file, 'rust') };
  }

  const tree = parser.parse(source);
  if (tree === null) {
    return { requests: [], unknown: `${file} could not be parsed as Rust.` };
  }

  const requests: Request[] = [];
  const exports: Export[] = [];
  const seen = new Map<string, Request>();
  let broken = false;

  const want = (request: Request): void => {
    const held = seen.get(request.value);
    if (held === undefined) {
      seen.set(request.value, request);
      requests.push(request);
      return;
    }
    // Written beats guessed. One `mod order;` and one `use self::order::X` name
    // the same file, and the first is the one that can be a hole.
    if (held.guessed === true && request.guessed !== true) {
      requests[requests.indexOf(held)] = request;
      seen.set(request.value, request);
    }
  };

  // `prefix` is the inline-module path this block sits inside. `mod b;` inside
  // `mod a { … }` is the file `a/b.rs`, so the nesting has to be carried down.
  const block = (node: GrammarNode, prefix: readonly string[], top: boolean): void => {
    const children = node.namedChildren;
    for (const [at, child] of children.entries()) {
      // This walk visits exactly the levels a `use` or `mod` can sit at, so an
      // error it steps over is the only kind that can have swallowed one.
      if (child.type === 'ERROR' || child.isMissing) broken = true;
      switch (child.type) {
        case 'mod_item': {
          const name = child.childForFieldName('name')?.text;
          if (name === undefined) break;
          const body = child.childForFieldName('body');
          const line = child.startPosition.row + 1;

          if (body === null) {
            // A declaration. `#[path = "…"]` on the statement above replaces the
            // name with a filename; it is a preceding sibling, not a child.
            const spelled = pathAttribute(children[at - 1]);
            want({
              value: spelled ?? ['self', ...prefix, name].join('::'),
              kind: 'imports',
              bindings: [{ imported: name, local: name, type: false, line }],
              line,
            });
          } else {
            block(body, [...prefix, name], false);
          }
          if (top && published(child)) {
            exports.push({ exported: name, local: name, type: false, line });
          }
          break;
        }

        case 'use_declaration': {
          const argument = child.childForFieldName('argument');
          if (argument === null) break;
          const line = child.startPosition.row + 1;
          const shared = published(child);
          for (const { path, local } of used(argument, [])) {
            const value = path.join('::');
            const last = path[path.length - 1] ?? value;
            want({
              value,
              kind: 'imports',
              bindings: [{ imported: last, local: local ?? last, type: false, line }],
              line,
              // Always. See the module doc: which prefix of a `use` is a module
              // is a fact about the disk, not about the statement.
              guessed: true,
            });
            // `pub use` is a re-export, and is the only thing in Rust that
            // republishes a name this file did not declare.
            if (shared) {
              exports.push({ exported: local ?? last, from: value, imported: last, type: false, line });
            }
          }
          break;
        }

        default: {
          if (!top) break;
          const name = named(child);
          if (name !== undefined && published(child)) {
            exports.push({
              exported: name,
              local: name,
              type: false,
              line: child.startPosition.row + 1,
            });
          }
        }
      }
    }
  };

  block(tree.rootNode, [], true);

  return {
    requests,
    ...(exports.length === 0 ? {} : { exports }),
    ...(broken
      ? { unknown: `${file} did not parse cleanly as Rust, so what it imports may be incomplete.` }
      : {}),
  };
}

/** Item kinds whose `name` field is a name this crate can publish. */
const ITEMS = new Set([
  'function_item',
  'struct_item',
  'enum_item',
  'union_item',
  'trait_item',
  'type_item',
  'const_item',
  'static_item',
]);

function named(node: GrammarNode): string | undefined {
  return ITEMS.has(node.type) ? node.childForFieldName('name')?.text : undefined;
}

function published(node: GrammarNode): boolean {
  return node.namedChildren.some((child) => child.type === 'visibility_modifier');
}

/** The filename in `#[path = "other.rs"]`, when the node above is that attribute. */
function pathAttribute(node: GrammarNode | undefined): string | undefined {
  if (node === undefined || node.type !== 'attribute_item') return undefined;
  const attribute = node.namedChildren.find((child) => child.type === 'attribute');
  if (attribute === undefined) return undefined;
  const key = attribute.namedChildren[0];
  if (key === undefined || key.text !== 'path') return undefined;
  const value = attribute.childForFieldName('value') ?? attribute.namedChildren[1];
  if (value === undefined || !value.type.endsWith('string_literal')) return undefined;
  return value.text.replace(/^[a-z]*"|"$/g, '');
}

/** One `use` argument flattened into the item paths it names. */
function used(
  node: GrammarNode,
  prefix: readonly string[],
): readonly { readonly path: readonly string[]; readonly local?: string }[] {
  switch (node.type) {
    case 'scoped_identifier': {
      return [{ path: withoutSelf([...prefix, ...segments(node)]) }];
    }
    case 'scoped_use_list': {
      const base = [...prefix, ...segments(node.childForFieldName('path'))];
      const list = node.childForFieldName('list');
      return list === null ? [] : list.namedChildren.flatMap((child) => used(child, base));
    }
    case 'use_list': {
      return node.namedChildren.flatMap((child) => used(child, prefix));
    }
    case 'use_as_clause': {
      const path = withoutSelf([...prefix, ...segments(node.childForFieldName('path'))]);
      const alias = node.childForFieldName('alias')?.text;
      return [alias === undefined ? { path } : { path, local: alias }];
    }
    case 'use_wildcard': {
      // `use a::b::*` — the module is the whole path, and the `*` names no item.
      const inner = node.namedChildren[0];
      return inner === undefined ? [] : [{ path: withoutSelf([...prefix, ...segments(inner)]) }];
    }
    default: {
      const own = segments(node);
      return own.length === 0 ? [] : [{ path: withoutSelf([...prefix, ...own]) }];
    }
  }
}

/**
 * `self` inside a list names the module the list hangs off, not a thing in it.
 *
 * `use crate::git::{self, Oid}` asks for `crate::git` twice over — once as the
 * module and once as a name in it — and only the first spelling is a module
 * path. Left in, the same file is asked for under two keys and the request the
 * dedupe keeps is the one nobody wrote.
 */
function withoutSelf(path: readonly string[]): readonly string[] {
  return path.length > 1 && path[path.length - 1] === 'self' ? path.slice(0, -1) : path;
}

function segments(node: GrammarNode | null): readonly string[] {
  if (node === null) return [];
  if (node.type === 'scoped_identifier') {
    const name = node.childForFieldName('name');
    return [...segments(node.childForFieldName('path')), ...(name === null ? [] : [name.text])];
  }
  // `crate`, `super`, `self` are their own node types, and their text is the word.
  return node.text === '' || node.text.includes('\n') ? [] : [node.text];
}

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
