/**
 * Names a file exports and no entry publishes, answered rather than refused.
 *
 * Exported for a neighbour and never published is most of any repository. A
 * caller who typed such a name exactly is not wrong about the name, only about
 * the door: `symbol` says where it is declared, and `uses` lists who imports it.
 *
 * The Help value records the imports that cross a package, and an import within
 * one is most of what an unpublished name has. So the imports come from the
 * source index, which holds every file's requests and what each resolved to:
 * an import counts when it resolved to a file that exports the name, or to a
 * file that passes it on with `export … from`, which is followed and is no use.
 */

// compass: variance-authority.report.agent-surface

import type { Documented, Entry, Help, Named, Opening, Taken, Use } from '@variance-authority/package/help';
import { importersOf } from '@variance-authority/sense';
import { useOf } from '../refresh-native.js';
import { declaration, importsByPath, type PathSite } from './by-path.js';
import { originOf } from './passed-on.js';

/** What an import count leaves out: a use that names the export without importing it. */
export const UNCOUNTED = 'a read through an `export * as` namespace and, outside Rust, a call through a qualified path are not counted';

/**
 * What a Rust answer leaves out: a use no path names. The reading follows the
 * paths a file writes and never resolves a type, so a glob, a method and a
 * macro are the type checker's.
 */
const RUST_UNREAD = "In Rust, a name a glob `use` brings in, a method called on a value and a macro are not read by path; rust-analyzer's find-references has those.";

/** The line that says so, when one of `files` is Rust. */
export function rustUnread(files: readonly string[]): readonly string[] {
  return files.some((file) => file.endsWith('.rs')) ? ['', RUST_UNREAD] : [];
}

/** Every export of `name` from ordinary source, in `within` when one is named. */
export function exportsNamed(help: Help, name: string, within: string | undefined): readonly Named[] {
  return help.exported.filter(
    (held) =>
      held.name === name &&
      held.kind === 'source' &&
      (within === undefined || held.by === within || fileOf(help, held, within)),
  );
}

/**
 * The exports of `name` that are other things than the declarations in
 * `answered`: an export whose file declares the name, or whose `export … from`
 * reaches a declaration, in a file `answered` does not hold. A published name
 * is one declaration, and a crate's `pub(crate)` item or a neighbour's export
 * of the same name in another file is another one, answered beside it.
 */
export function exportsApart(help: Help, root: string | undefined, name: string, within: string | undefined, answered: ReadonlySet<string>): readonly Named[] {
  const exported = exportsNamed(help, name, within);
  if (answered.size === 0) return exported;
  return exported.filter((held) => !answered.has(held.at) && !answered.has(originOf(root, held)?.at ?? held.at));
}

/**
 * The exports of a name that declare it, each with the imports the source index
 * resolved to it: a file that passes on another one's export is left out.
 */
export function declaringExports(name: string, exported: readonly Named[], root: string | undefined): readonly (readonly [Named, Within])[] {
  const read = exported.map((held) => [held, importsOf(root, [held.at], name)] as const);
  const passing = new Set(read.flatMap(([, within]) => ('through' in within ? within.through : [])));
  // Files that pass the name on to each other and declare it nowhere else are all shown.
  const declaring = read.filter(([held]) => !passing.has(held.at));
  return declaring.length > 0 ? declaring : read;
}

/**
 * Whether `within`, a specifier past `held`'s package name, names `held`'s file:
 * whether an import of exactly `within` resolved to it. Which file a specifier
 * names is the resolver's answer for an importer, so a specifier nothing
 * imports names no file.
 */
function fileOf(help: Help, held: Named, within: string): boolean {
  if (!within.startsWith(`${held.by}/`)) return false;
  return importsByPath(help, within).some(([deep]) => deep.specifier === within && deep.to === held.at);
}

/** `at:line`, and how many more exports there are past the first. */
export function exportedAt(exported: readonly Named[]): string {
  const [first] = exported;
  if (first === undefined) return '';
  const more = exported.length > 1 ? ` and ${exported.length - 1} more` : '';
  return `${first.at}:${first.line}${more}`;
}

/** One use the source index resolved, with the specifier its file wrote. */
export type IndexedUse = Taken & { readonly specifier: string };

/**
 * What the source index says about the imports of one name out of a set of
 * files: each use with the name it takes, every file that passes the name on
 * with `export … from`, and each line of one of the files that uses the name
 * it declares there; or why it could not be read.
 */
export type Within =
  | { readonly uses: readonly IndexedUse[]; readonly through: readonly string[]; readonly inFile: readonly Use[] }
  | { readonly unread: string };

/**
 * Every import of `name` out of one of `files`, or out of a file that passes it
 * on from one, read off the source index of `root`, or why that index says
 * nothing: no checkout named, none published, or one that does not read.
 */
export function importsOf(root: string | undefined, files: readonly string[], name: string): Within {
  if (root === undefined) return { unread: 'this host named no checkout to read the source index of' };
  let read: ReturnType<typeof importersOf>;
  try {
    read = importersOf(root, files, name);
  } catch (error) {
    return { unread: `${error instanceof Error ? error.message : String(error)}; run \`variance index\`` };
  }
  if (read === undefined) return { unread: 'no source index is published; run `variance index`' };
  const inFile = read.inFile.map((use): Use => ({ at: use.at, line: use.line, by: use.by, kind: use.kind, type: false }));
  return { uses: read.uses.map((use) => ({ name: use.name, specifier: use.key, ...useOf(use) })), through: read.through, inFile };
}

/** The refusal when the imports cannot be read: the export is known, the index that holds its importers is not. */
export function indexMissing(name: string, exported: readonly Named[], unread: string): string {
  return `\`${name}\` is exported, without being published, at ${exportedAt(exported)}; who imports it is read from the source index, and ${unread}.`;
}

/**
 * The files a published entry or an import by path already answers the name
 * from: the declaration each entry reaches, the entry file that passes it on,
 * and the file each import by path names it from.
 */
export function answeredBy(help: Help, name: string, found: readonly (readonly [Documented, Opening, Entry])[], byPath: readonly PathSite[]): ReadonlySet<string> {
  return new Set([
    ...found.flatMap(([, opening, entry]) => [entry.at, opening.source]),
    ...byPath.flatMap((site) => [site.held.to ?? declaration(help, name, site)?.at].filter((at): at is string => at !== undefined)),
  ]);
}
