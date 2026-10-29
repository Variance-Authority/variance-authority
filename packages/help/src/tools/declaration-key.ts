/**
 * Which declaration an export is, and the name it is keyed by.
 *
 * A declaration is the file that declares it and the name that file exports
 * it under. `export default greet` beside `export { greet }` is one
 * declaration, `greet`, and `default` is a slot every module has, not a name:
 * it keys a declaration only when nothing names it. A named default,
 * `export default function Badge`, is keyed by the name it binds; an anonymous
 * one by the local name of the import nearest its file, else by the nearest
 * export that passes it on under a name.
 *
 * The package stage carries what each export binds in its own file, so a key
 * is computed in memory; only an anonymous default and an export that passes
 * another file's declaration on read the source index, once each per `Help`.
 */

// compass: variance-authority.report.agent-surface

import type { Help, Named } from '@variance-authority/package/help';
import { aliasesOf, declarationExported, importersOf, type ExportedDeclaration } from '@variance-authority/sense';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { nearestTo } from './shared-segments.js';

/** The name a default export is published under, which names nothing. */
export const SLOT = 'default';

/** Whether `spelling`, a name something is exported or imported under, says `name`: the slot says no name, not even its own. */
export const says = (spelling: string, name: string): boolean => spelling === name && spelling !== SLOT;

/** One declaration: where it is declared, the name it is keyed by, and every name its file exports it under, in code units. */
export interface Key {
  readonly at: string;
  readonly named: string;
  readonly spellings: readonly string[];
}

interface Keys {
  /** By file, the name each export of a binding of its own binds. */
  readonly binds: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** By file, and by binding, every name the file exports it under. */
  readonly names: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
  readonly anonymous: Map<string, string | undefined>;
  readonly origins: Map<string, ExportedDeclaration | undefined>;
  readonly aliased: Map<string, ReadonlySet<string>>;
}

const memo = new WeakMap<Help, Map<string, Keys>>();

function keysOf(help: Help, root: string | undefined): Keys {
  const byRoot = memo.get(help) ?? new Map<string, Keys>();
  memo.set(help, byRoot);
  const held = byRoot.get(root ?? '');
  if (held !== undefined) return held;
  const binds = new Map<string, Map<string, string>>();
  const names = new Map<string, Map<string, string[]>>();
  for (const one of help.exported) {
    if (one.bound === undefined) continue;
    const file = binds.get(one.at) ?? new Map<string, string>();
    binds.set(one.at, file);
    file.set(one.name, one.bound);
    const bound = names.get(one.at) ?? new Map<string, string[]>();
    names.set(one.at, bound);
    const spelled = bound.get(one.bound) ?? [];
    bound.set(one.bound, spelled);
    if (!spelled.includes(one.name)) spelled.push(one.name);
  }
  for (const file of names.values()) for (const spelled of file.values()) spelled.sort(codeUnitOrder);
  const keys: Keys = { binds, names, anonymous: new Map(), origins: new Map(), aliased: new Map() };
  byRoot.set(root ?? '', keys);
  return keys;
}

/**
 * The declaration `held` exports. One its own file binds is keyed there; one
 * that passes another file's on is the declaring file's export of the same
 * binding, under `held`'s name alone. Without a source index such an export
 * is keyed where it is written.
 */
export function keyOf(help: Help, root: string | undefined, held: Pick<Named, 'at' | 'name'>): Key {
  const keys = keysOf(help, root);
  const bound = keys.binds.get(held.at)?.get(held.name);
  if (bound !== undefined) return ownKey(help, root, keys, held.at, bound);
  const origin = originOf(help, root, held);
  if (origin === undefined) return { at: held.at, named: held.name, spellings: [held.name] };
  return { at: origin.at, named: originKey(help, root, origin).named, spellings: [held.name] };
}

/** The key of `origin`, a declaration the source index walked to: its declaring file's export of the same binding. */
export function originKey(help: Help, root: string | undefined, origin: ExportedDeclaration): Key {
  const keys = keysOf(help, root);
  const own = [...(keys.binds.get(origin.at) ?? [])].some(([, binds]) => binds === origin.name);
  return own ? ownKey(help, root, keys, origin.at, origin.name) : { at: origin.at, named: origin.name, spellings: [origin.name] };
}

function ownKey(help: Help, root: string | undefined, keys: Keys, at: string, bound: string): Key {
  const spellings = keys.names.get(at)?.get(bound) ?? [bound];
  const named = spellings.includes(bound) ? bound : (spellings.find((one) => one !== SLOT) ?? bound);
  return { at, named: named === SLOT ? (anonymousName(help, root, keys, at) ?? SLOT) : named, spellings };
}

/**
 * Whether `held` answers to `name`: it is exported under it, or the binding
 * its own file exports is keyed by it or exported under it too, or, for an
 * anonymous default, an import of it binds `name`. An export that
 * passes another file's declaration on answers only to its own name, and the
 * slot to defaults nothing names; asked by the slot, every default reads its
 * key.
 */
export function answers(help: Help, root: string | undefined, held: Pick<Named, 'at' | 'name'>, name: string): boolean {
  if (says(held.name, name)) return true;
  const bound = keysOf(help, root).binds.get(held.at)?.get(held.name);
  if (bound === undefined) return name === SLOT && held.name === SLOT && keyOf(help, root, held).named === SLOT;
  // An anonymous default answers every local name an import of it gives, the one it is keyed by among them.
  if (bound === SLOT && name !== SLOT) return aliasedTo(help, root, name).has(held.at);
  const key = keyOf(help, root, held);
  return key.named === name || key.spellings.some((one) => says(one, name));
}

/**
 * The declaration `held` binds: its file's own, or the one it passes on
 * through every file that passes it on. None when the walk ends short of a
 * declaration, when no checkout is named, and when the index is not published
 * or does not read, which the imports of the same answer already say.
 */
export function boundOf(root: string | undefined, held: Pick<Named, 'at' | 'name'>): ExportedDeclaration | undefined {
  return root === undefined ? undefined : (whenRead(() => declarationExported(root, held.at, held.name)) ?? undefined);
}

/**
 * What `read` reads from the source index, or nothing when the index is not
 * published or does not read: the imports of the same answer say so, and a key
 * read without it falls back to the name the export is written under.
 */
function whenRead<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** The declaration `held` passes on from another file, as the source index walks to it; none when its own file declares it or the index does not read. */
export function originOf(help: Help, root: string | undefined, held: Pick<Named, 'at' | 'name'>): ExportedDeclaration | undefined {
  if (root === undefined || keysOf(help, root).binds.get(held.at)?.has(held.name) === true) return undefined;
  const origins = keysOf(help, root).origins;
  const at = `${held.at}\0${held.name}`;
  if (!origins.has(at)) {
    const bound = boundOf(root, held);
    origins.set(at, bound === undefined || bound.at === held.at ? undefined : bound);
  }
  return origins.get(at);
}

/** The files an import of `default` bound to `name` reaches: the file it resolved to, and the declaring file of a default that file passes on. */
function aliasedTo(help: Help, root: string | undefined, name: string): ReadonlySet<string> {
  if (root === undefined) return new Set();
  const keys = keysOf(help, root);
  let files = keys.aliased.get(name);
  if (files === undefined) {
    const to = (whenRead(() => aliasesOf(root, name)) ?? []).flatMap((alias) => (alias.imported === SLOT && alias.to != null ? [alias.to] : []));
    files = new Set(to.flatMap((at) => {
      const origin = originOf(help, root, { at, name: SLOT });
      return origin === undefined ? [at] : [at, origin.at];
    }));
    keys.aliased.set(name, files);
  }
  return files;
}

/**
 * The name the anonymous default of `at` is known by: the local name of the
 * import nearest its file, else the name the nearest export that passes it on
 * gives it. None when nothing names it or no checkout is named.
 */
function anonymousName(help: Help, root: string | undefined, keys: Keys, at: string): string | undefined {
  if (root === undefined) return undefined;
  if (!keys.anonymous.has(at)) {
    const read = whenRead(() => importersOf(root, [at], SLOT));
    const local = (read?.uses ?? [])
      .flatMap((use) => (typeof use.local === 'string' && use.local !== '' ? [{ at: use.at, line: use.line, name: use.local }] : []))
      .sort(nearestTo(at))[0]?.name;
    keys.anonymous.set(at, local ?? doorName(help, root, at, new Set(read?.through ?? [])));
  }
  return keys.anonymous.get(at);
}

/** The name the export nearest `at` among `through`, the files that pass its default on, gives it. */
function doorName(help: Help, root: string, at: string, through: ReadonlySet<string>): string | undefined {
  const naming = help.exported.filter((door) => through.has(door.at) && door.bound === undefined && door.name !== SLOT && door.kind === 'source' && originOf(help, root, door)?.at === at && originOf(help, root, door)?.name === SLOT);
  return naming.sort(nearestTo(at))[0]?.name;
}
