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
 * is computed from that file's rows; only an anonymous default and an export that passes
 * another file's declaration on read the source index, once each per `Help`.
 */

// compass: variance-authority.report.agent-surface

import type { Help, Named } from '@variance-authority/package/help';
import { aliasesOf, declarationExported, importersOf, type ExportedDeclaration } from '@variance-authority/sense';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { exportedAmong, exportedIn } from './rows.js';
import type { DeclarationLookups } from './exported-matches.js';
import { enteredThrough } from './by-path.js';
import { searchIndexOf } from '../snapshot.js';
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

/** What one file's exports bind: the name each export of a binding of its own binds, and, by binding, every name the file exports it under. */
interface FileKeys {
  readonly binds: ReadonlyMap<string, string>;
  readonly names: ReadonlyMap<string, readonly string[]>;
}

interface Keys {
  /** By file, as each is asked about: a question names a few files, and the export list holds every file's. */
  readonly files: Map<string, FileKeys>;
  readonly anonymous: Map<string, string | undefined>;
  readonly origins: Map<string, ExportedDeclaration | undefined>;
  readonly aliased: Map<string, ReadonlySet<string>>;
}

const memo = new WeakMap<Help, Map<string, Keys>>();

function keysOf(help: Help, root: string | undefined): Keys {
  const byRoot = memo.get(help) ?? new Map<string, Keys>();
  memo.set(help, byRoot);
  let keys = byRoot.get(root ?? '');
  if (keys === undefined) byRoot.set(root ?? '', (keys = { files: new Map(), anonymous: new Map(), origins: new Map(), aliased: new Map() }));
  return keys;
}

/** What the exports of `at` bind, read off that file's rows alone. */
function fileKeys(help: Help, keys: Keys, at: string): FileKeys {
  let held = keys.files.get(at);
  if (held === undefined) {
    const binds = new Map<string, string>();
    const names = new Map<string, string[]>();
    for (const one of exportedIn(help, at)) {
      if (one.bound === undefined) continue;
      binds.set(one.name, one.bound);
      const spelled = names.get(one.bound) ?? [];
      names.set(one.bound, spelled);
      if (!spelled.includes(one.name)) spelled.push(one.name);
    }
    for (const spelled of names.values()) spelled.sort(codeUnitOrder);
    keys.files.set(at, (held = { binds, names }));
  }
  return held;
}

/**
 * The declaration `held` exports. One its own file binds is keyed there; one
 * that passes another file's on is the declaring file's export of the same
 * binding, under `held`'s name alone. Without a source index such an export
 * is keyed where it is written.
 */
export function keyOf(help: Help, root: string | undefined, held: Pick<Named, 'at' | 'name'>): Key {
  const keys = keysOf(help, root);
  const bound = fileKeys(help, keys, held.at).binds.get(held.name);
  if (bound !== undefined) return ownKey(help, root, keys, held.at, bound);
  const origin = originOf(help, root, held);
  if (origin === undefined) return { at: held.at, named: held.name, spellings: [held.name] };
  return { at: origin.at, named: originKey(help, root, origin).named, spellings: [held.name] };
}

/** The key of `origin`, a declaration the source index walked to: its declaring file's export of the same binding. */
export function originKey(help: Help, root: string | undefined, origin: ExportedDeclaration): Key {
  const keys = keysOf(help, root);
  const own = [...fileKeys(help, keys, origin.at).binds].some(([, binds]) => binds === origin.name);
  return own ? ownKey(help, root, keys, origin.at, origin.name) : { at: origin.at, named: origin.name, spellings: [origin.name] };
}

function ownKey(help: Help, root: string | undefined, keys: Keys, at: string, bound: string): Key {
  const spellings = fileKeys(help, keys, at).names.get(bound) ?? [bound];
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
  const bound = fileKeys(help, keysOf(help, root), held.at).binds.get(held.name);
  if (bound === undefined) return name === SLOT && held.name === SLOT && keyOf(help, root, held).named === SLOT;
  // An anonymous default answers every local name an import of it gives, the one it is keyed by among them.
  if (bound === SLOT && name !== SLOT) return aliasedTo(help, root, name).has(held.at);
  const key = keyOf(help, root, held);
  return key.named === name || key.spellings.some((one) => says(one, name));
}

/**
 * Every export that answers to `name`, in the order the export list holds
 * them. An export answers by its own name, by a name its file exports the
 * same binding under, by the name its file binds a default nothing else names
 * as, or, for an anonymous default, by a local name an import gives it: so the
 * rows that can answer are the ones written under the name, the other rows of
 * their files, the rows bound as the name, and the rows of the files an import
 * of `default` bound to the name reaches. Asked by the slot, the defaults and
 * the rows bound as it.
 */
export function answering(help: Help, root: string | undefined, name: string): readonly Named[] {
  const rows = searchIndexOf(help).rows;
  const spelled = rows.exportedNamed(name);
  const can = new Set<number>(spelled);
  if (name !== SLOT) {
    const files = new Set([...spelled].map((row) => rows.named(row).at));
    for (const at of aliasedTo(help, root, name)) files.add(at);
    for (const at of files) for (const row of rows.exportedIn(at)) can.add(row);
  }
  for (const row of rows.exportedBinding(name)) can.add(row);
  return [...can].sort((left, right) => left - right).map(rows.named).filter((held) => answers(help, root, held, name));
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
 * For each of `declared`, every file that passes it on, `export *` included,
 * in code-unit order. None when the index does not read.
 */
function passersOf(root: string, declared: readonly Pick<Named, 'at' | 'name'>[]): readonly (readonly string[])[] | undefined {
  return whenRead(() => importersOf(root, declared.map((one) => [{ file: one.at, name: one.name }])))?.groups.map((group) => group.through);
}

/** What the source index and the package reading answer about the exported rows `search` shows; none when no checkout is named. */
export function declarationLookupsOf(help: Help, root: string | undefined): DeclarationLookups | undefined {
  if (root === undefined) return undefined;
  return { of: (at, name) => boundOf(root, { at, name }), passersOf: (declared) => passersOf(root, declared), entered: (name, files, by) => enteredThrough(help, name, files, by) };
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
  if (root === undefined || fileKeys(help, keysOf(help, root), held.at).binds.has(held.name)) return undefined;
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
    const read = whenRead(() => importersOf(root, [[{ file: at, name: SLOT }]]))?.groups[0];
    const local = (read?.uses ?? [])
      .flatMap((use) => (typeof use.local === 'string' && use.local !== '' ? [{ at: use.at, line: use.line, name: use.local }] : []))
      .sort(nearestTo(at))[0]?.name;
    keys.anonymous.set(at, local ?? doorName(help, root, at, new Set(read?.through ?? [])));
  }
  return keys.anonymous.get(at);
}

/** The name the export nearest `at` among `through`, the files that pass its default on, gives it. */
function doorName(help: Help, root: string, at: string, through: ReadonlySet<string>): string | undefined {
  const naming = exportedAmong(help, through).filter((door) => door.bound === undefined && door.name !== SLOT && door.kind === 'source' && originOf(help, root, door)?.at === at && originOf(help, root, door)?.name === SLOT);
  return naming.sort(nearestTo(at))[0]?.name;
}
