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
 * tell, so every `use` is marked {@link Request.guessed}, and resolution walks
 * the module tree the crate's `mod` lines declare, segment by segment, until a
 * segment is no module: the file it stands in declares the item. A `use` that
 * finds nothing is an external crate — which is the common case, not an error —
 * and silence is the honest answer.
 *
 * A path written in a type or an expression, `crate::graph::Limits` or
 * `super::reach()`, names an item the same way and is read the same way, with
 * one more doubt: `crate::map::JourneyMap::new()` may be a function of the type
 * as well as of a module. So every prefix of it is asked for as an
 * {@link Request.item}, and only the one that leaves a single segment past the
 * modules lands, and only where the file the walk stands in declares that
 * segment as an item: `crate::shapes::inner::Thing` passes through the inline
 * `mod inner` of `shapes.rs`, and its prefix `crate::shapes::inner` names no
 * item there, whatever else `shapes.rs` calls `inner`. A single name is not: which item it means is a matter of scope, and the `use`
 * that brought it in is already counted.
 *
 * That split is what keeps the two from poisoning each other. Inline modules
 * (`mod tests { … }`) declare no file at all, and if `use` were written-certain
 * every `use super::*` inside one would be reported as a missing file.
 *
 * ## `#[path]` names a file directly
 *
 * The one place Rust does spell a path. At the top of a file it is relative to
 * the directory the file is in, and the reader emits it as written. Inside an
 * inline module it starts at that module's directory, so the reader emits the
 * module first, `self::inline/other.rs`, and the directory is decided here,
 * where `lib.rs`, `main.rs`, `mod.rs` and a file a `#[path]` loads are known to
 * own theirs. The two
 * encodings are told apart by a character a Rust path cannot hold: a module path
 * is `::`-joined identifiers, so anything carrying `.` or `/` is a filename.
 * The file a `#[path]` loads keeps its own children beside it, as a `mod.rs`
 * does, which is why `super` is read from the `mod` lines and never from where a
 * file sits.
 *
 * ## Inline modules
 *
 * `self` and `super` in a `use` inside `mod tests { … }` name that module and
 * the file around it, so the reader folds them into a path from the file's own
 * module before it gets here: `use super::helper` in `tests` of `foo.rs` arrives
 * as `self::helper`, an item of `foo.rs`, and lands on nothing.
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

import type { SourceSymbol } from './harvest.js';
import { NAMESPACE_NAME } from './read.js';
import type { TreeWorld } from './world.js';

/** What a crate's source sits under, by universal convention and by Cargo. */
const SOURCE = 'src';

/** The files that are a module without naming one: a crate root, or a directory's own. */
const ROOT_FILES = ['lib.rs', 'main.rs', 'mod.rs'];

/** The files a crate's own `src` starts at. */
const ROOTS = ['lib.rs', 'main.rs'];

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
 * the many-answer shape the other languages need is unused here. Never the file
 * that asks: an item a file reaches through its own module is declared in it,
 * and an edge from a file to itself carries nothing.
 */
export function resolveRust(input: {
  readonly from: string;
  readonly request: string;
  readonly world: TreeWorld;
  /** The whole path is the item, so it lands only with one segment left past the modules. */
  readonly item?: boolean | undefined;
}): readonly string[] {
  const { from, request, world, item } = input;

  if (spelledPath(request)) {
    const at = spelledFile(from, request, moduleTree(world).spelled);
    return at !== undefined && at !== from && world.has(at) ? [at] : [];
  }

  const written = request.split('::').filter((segment) => segment !== '');
  if (written.length === 0) return [];
  const modules = moduleTree(world);

  let at: Place | undefined;
  let rest: readonly string[];
  switch (written[0]) {
    case 'crate': {
      at = { file: rootOf(from, world, modules), inline: [] };
      rest = written.slice(1);
      break;
    }
    case 'self': {
      at = { file: from, inline: [] };
      rest = written.slice(1);
      break;
    }
    case 'super': {
      at = { file: from, inline: [] };
      let climbed = 0;
      while (written[climbed] === 'super' && at !== undefined) {
        at = at.inline.length > 0 ? { file: at.file, inline: at.inline.slice(0, -1) } : parentOf(at.file, world, modules);
        climbed += 1;
      }
      rest = written.slice(climbed);
      break;
    }
    default: {
      // A crate name. The crate's own name reaches its own files too: Rust
      // allows `use my_crate::x` from inside `my_crate`.
      const crate = crateIndex(world).byName.get(written[0]!);
      const root = crate === undefined ? undefined : ROOTS.map((name) => `${sourceOf(crate)}/${name}`).find((path) => world.has(path));
      at = root === undefined ? undefined : { file: root, inline: [] };
      rest = written.slice(1);
    }
  }
  if (at === undefined) return [];

  // Down the tree while a segment is a module: a file one declares, or an
  // inline module a file is declared in. The first segment that is neither is
  // the item, and the file the walk stands in declares it.
  let walked = 0;
  for (const segment of rest) {
    const child = childOf(at, segment, world, modules);
    if (child !== undefined) at = { file: child, inline: [] };
    else if (holdsInline(at, segment, world, modules)) at = { file: at.file, inline: [...at.inline, segment] };
    else break;
    walked += 1;
  }
  if (item === true && (rest.length - walked !== 1 || !declaresItem(at, rest[walked]!, modules))) return [];
  return at.file === from ? [] : [at.file];
}

/** A module: the file it is written in, and the inline modules it sits inside there. */
interface Place {
  readonly file: string;
  readonly inline: readonly string[];
}

/**
 * The module tree the crates' `mod` lines declare: which module declares each
 * file, and the files each one declares, keyed by the path from that file —
 * `inner::deep` for `mod deep;` inside `mod inner { … }`.
 *
 * Read from the files rather than from where they sit, because `#[path]` puts a
 * module anywhere: `lexicon.rs` may declare `lexicon_view.rs` beside it, and
 * `super` there is `lexicon`, which no directory says. A file the world has no
 * text for has no entry, and is placed by the layout Cargo defaults to.
 */
interface ModuleTree {
  readonly parent: ReadonlyMap<string, Place>;
  readonly children: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** The files a `#[path]` loads, which hold their own children beside them, as a `mod.rs` does. */
  readonly spelled: ReadonlySet<string>;
  /**
   * What each file declares at its top level, by name: the kinds of item, and
   * whether a `mod` of that name is written inline. Only for a file whose
   * declarations the scan read; absent, a file's items are not known.
   */
  readonly items: ReadonlyMap<string, Items>;
}

/** A file's top-level names: those it declares as an item, and those it declares as an inline `mod`. */
export interface Items {
  readonly declared: ReadonlySet<string>;
  readonly inline: ReadonlySet<string>;
}

function moduleTree(world: TreeWorld): ModuleTree {
  return world.index('rust:modules', (tree) => {
    const parent = new Map<string, Place>();
    const children = new Map<string, Map<string, string>>();
    const spelled = new Set<string>();
    const items = new Map<string, Items>();
    const declared: (readonly [string, string, string])[] = [];

    for (const file of tree.below('')) {
      if (!file.endsWith('.rs')) continue;
      // The scan's own parse: a file is read once, whichever of the two asks first.
      const read = tree.parsed(file);
      if (read === undefined) continue;
      children.set(file, new Map());
      const files = new Set<string>();
      for (const request of read.requests) {
        const [binding] = request.bindings;
        // A `mod` line: written, and the file taken whole under its name.
        if (request.guessed === true || binding?.imported !== NAMESPACE_NAME) continue;
        declared.push([file, request.value, binding.local]);
        if (request.value === `self::${binding.local}` || (spelledPath(request.value) && !inlineSpelled(request.value))) files.add(binding.local);
      }
      if (read.harvested === true) items.set(file, topLevelItems(read.symbols ?? [], files));
    }

    const place = (file: string, key: string, child: string, inline: readonly string[]): void => {
      if (child === file) return;
      parent.set(child, { file, inline });
      children.get(file)?.set(key, child);
    };
    // Spelled first: they say which files keep their children beside them. A
    // top-level one is placed before one inside an inline module, whose
    // directory depends on whether its own file is one of them.
    const spelledOnes = declared.filter(([, value]) => spelledPath(value));
    for (const [file, value, name] of [...spelledOnes.filter(([, value]) => !inlineSpelled(value)), ...spelledOnes.filter(([, value]) => inlineSpelled(value))]) {
      const child = spelledFile(file, value, spelled);
      if (child === undefined || !tree.has(child)) continue;
      spelled.add(child);
      const inline = inlineOf(value);
      place(file, [...inline, name].join('::'), child, inline);
    }
    for (const [file, value] of declared) {
      if (spelledPath(value)) continue;
      const path = value.split('::').slice(1);
      const name = path.at(-1);
      if (name === undefined) continue;
      const inline = path.slice(0, -1);
      const child = declaredFile(file, inline, name, tree, spelled);
      if (child !== undefined) place(file, path.join('::'), child, inline);
    }
    return { parent, children, spelled, items };
  });
}

/**
 * What a file declares at its top level, from the declarations the reader
 * recorded for it; `files` are the names its `mod name;` lines take.
 */
export function topLevelItems(symbols: readonly SourceSymbol[], files: ReadonlySet<string>): Items {
  // The reader names a declaration inside an inline module on its path,
  // `tests::fixture`, and that is an item of the module, not of the file.
  const top = symbols.filter(({ name }) => !name.includes('::'));
  return {
    declared: new Set(top.filter(({ kind }) => kind !== 'module').map(({ name }) => name)),
    // A `mod` that is no `mod name;` line is written inline.
    inline: new Set(top.filter(({ kind, name }) => kind === 'module' && !files.has(name)).map(({ name }) => name)),
  };
}

/**
 * Whether the reader wrote a `#[path]` after the inline modules it sits inside,
 * `self::a::b/other.rs`: the one form of a spelled path that starts `self::`.
 */
function inlineSpelled(request: string): boolean {
  return request.startsWith('self::') && request.includes('/');
}

/** The inline modules a `#[path]` sits inside, `a::b` of `self::a::b/other.rs`; none at the top of a file. */
function inlineOf(request: string): readonly string[] {
  return inlineSpelled(request) ? request.slice('self::'.length, request.indexOf('/')).split('::') : [];
}

/**
 * The file a `#[path]` in `file` names. At the top of the file it is relative
 * to the file's own directory, as the Rust Reference has it; inside inline
 * modules it starts at the directory the file keeps its children in, with a
 * directory for each of those modules.
 */
function spelledFile(file: string, request: string, spelled: ReadonlySet<string>): string | undefined {
  if (!inlineSpelled(request)) return normalize(`${directoryOf(file)}/${request}`);
  return normalize([childDirectories(file, spelled)[0]!, ...inlineOf(request), request.slice(request.indexOf('/') + 1)].join('/'));
}

/** The file `mod name;` inside `inline` of `file` declares, as Cargo lays one out. */
function declaredFile(file: string, inline: readonly string[], name: string, world: TreeWorld, spelled: ReadonlySet<string>): string | undefined {
  for (const directory of childDirectories(file, spelled)) {
    const at = [directory, ...inline].join('/');
    const found = [`${at}/${name}.rs`, `${at}/${name}/mod.rs`].map(normalize).find((path) => path !== undefined && world.has(path));
    if (found !== undefined) return found;
  }
  return undefined;
}

/**
 * Where a file's child modules can live. `lib.rs`, `main.rs`, `mod.rs` and a
 * file a `#[path]` loads hold them beside themselves; any other file in its own
 * directory, or beside itself when it is a crate root no module declares — a
 * test or an example target is one, and nothing in its name says so.
 */
function childDirectories(file: string, spelled: ReadonlySet<string>): readonly string[] {
  const beside = directoryOf(file);
  const name = file.slice(file.lastIndexOf('/') + 1);
  if (ROOT_FILES.includes(name) || spelled.has(file)) return [beside];
  return [moduleDirectory(file), beside];
}

function childOf(at: Place, segment: string, world: TreeWorld, modules: ModuleTree): string | undefined {
  const declared = modules.children.get(at.file);
  if (declared !== undefined) return declared.get([...at.inline, segment].join('::'));
  const child = declaredFile(at.file, at.inline, segment, world, modules.spelled);
  return child === at.file ? undefined : child;
}

/** Whether `segment` is an inline module in `at`'s file: one it declares at its top level, or one a file is declared inside. */
function holdsInline(at: Place, segment: string, world: TreeWorld, modules: ModuleTree): boolean {
  if (at.inline.length === 0 && modules.items.get(at.file)?.inline.has(segment) === true) return true;
  const key = [...at.inline, segment, ''].join('::');
  const declared = modules.children.get(at.file);
  if (declared !== undefined) return [...declared.keys()].some((name) => name.startsWith(key));
  return childDirectories(at.file, modules.spelled).some((directory) => world.below([directory, ...at.inline, segment].join('/')).length > 0);
}

/**
 * Whether the module at `at` declares `name` as an item. Known for a file's
 * top level when the scan read its declarations; inside an inline module, or
 * for a file whose declarations were not read, the walk's answer stands.
 */
function declaresItem(at: Place, name: string, modules: ModuleTree): boolean {
  const items = modules.items.get(at.file);
  return at.inline.length > 0 || items === undefined || items.declared.has(name);
}

/**
 * The module that declares a file: the one its `mod` line is in, or, for a file
 * the world has no text for, the parent Cargo's layout puts it under.
 */
function parentOf(file: string, world: TreeWorld, modules: ModuleTree): Place | undefined {
  const declared = modules.parent.get(file);
  if (declared !== undefined) return declared;
  const name = file.slice(file.lastIndexOf('/') + 1);
  if (name === 'lib.rs' || name === 'main.rs') return undefined;
  // `a/b/mod.rs` is the module `a/b`, and `a/b.rs` is too: its parent is `a`'s own file.
  const module = name === 'mod.rs' ? directoryOf(file) : moduleDirectory(file);
  const up = directoryOf(module);
  const candidates = [...ROOT_FILES.map((root) => (up === '' ? root : `${up}/${root}`)), ...(up === '' ? [] : [`${up}.rs`])];
  const found = candidates.find((path) => path !== file && world.has(path));
  // A parent whose `mod` lines were read and do not name this file is not its parent.
  if (found === undefined || modules.children.has(found)) return undefined;
  return { file: found, inline: [] };
}

/** The crate root a file's `crate` names: the top of the chain of modules that declare it. */
function rootOf(file: string, world: TreeWorld, modules: ModuleTree): string {
  const seen = new Set<string>([file]);
  let at = file;
  for (let up = parentOf(at, world, modules); up !== undefined && !seen.has(up.file); up = parentOf(at, world, modules)) {
    at = up.file;
    seen.add(at);
  }
  return at;
}

function directoryOf(file: string): string {
  const cut = file.lastIndexOf('/');
  return cut === -1 ? '' : file.slice(0, cut);
}

/**
 * The directory a file's child modules live in.
 *
 * `src/a/mod.rs` and `src/lib.rs` are the module *of* their directory, so their
 * children sit beside them. Every other file owns a directory named after it,
 * which is the 2018-edition layout and the only one in use.
 */
function moduleDirectory(file: string): string {
  const directory = directoryOf(file);
  const name = file.slice(file.lastIndexOf('/') + 1);
  const stem = name.replace(/\.rs$/, '');
  return ROOT_FILES.includes(name) ? directory : directory === '' ? stem : `${directory}/${stem}`;
}

interface Crates {
  /** Crate name as `use` spells it → the crate's directory. */
  readonly byName: ReadonlyMap<string, string>;
}

function crateIndex(world: TreeWorld): Crates {
  return world.index('rust:crates', (tree) => {
    const byName = new Map<string, string>();

    for (const path of tree.below('')) {
      if (path !== 'Cargo.toml' && !path.endsWith('/Cargo.toml')) continue;
      const directory = path.slice(0, Math.max(0, path.length - 'Cargo.toml'.length - 1));
      // The manifest name when the manifest can be read, and the directory name
      // otherwise — a world built from a bare list of paths has no bytes. Both
      // are normalised the way Cargo does: a hyphen in a manifest is an
      // underscore in every `use` that names it.
      const declared = manifestName(tree.text(path));
      const name = (declared ?? directory.slice(directory.lastIndexOf('/') + 1)).replace(/-/g, '_');
      if (name !== '') byName.set(name, directory);
    }

    return { byName };
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
