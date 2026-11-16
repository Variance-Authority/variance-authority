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

import type { Help, Named, Taken, Use } from '@variance-authority/package/help';
import { importersOf } from '@variance-authority/sense';
import { useOf } from '../native-use.js';
import { answering as answersTo, says } from './declaration-key.js';
import { pathsWritten } from './rows.js';

/** What an import count leaves out: a use that names the export without importing it. */
export const UNCOUNTED = 'a namespace imported by name that goes somewhere whole and, outside Rust, a call through a qualified path are not counted';

/**
 * Every export of `name` from ordinary source, in `within` when one is named,
 * and every default export its declaration is named `name` by.
 */
export function exportsNamed(help: Help, root: string | undefined, name: string, within: string | undefined): readonly Named[] {
  const answering = answersTo(help, root, name).filter((held) => held.kind === 'source');
  // A file that exports the binding by the name is answered by that export, not by its other names.
  const spelled = answering.filter((held) => says(held.name, name));
  const keyed = answering.filter((held) => !says(held.name, name) && !spelled.some((other) => other.at === held.at));
  return [...spelled, ...keyed].filter((held) => within === undefined || held.by === within || fileOf(help, held, within));
}

/**
 * Whether `within`, a specifier past `held`'s package name, names `held`'s file:
 * whether an import of exactly `within` resolved to it. Which file a specifier
 * names is the resolver's answer for an importer, so a specifier nothing
 * imports names no file.
 */
function fileOf(help: Help, held: Named, within: string): boolean {
  if (!within.startsWith(`${held.by}/`)) return false;
  return pathsWritten(help, within).some(([deep]) => deep.to === held.at);
}

/** `at:line`, and how many more exports there are past the first. */
export function exportedAt(exported: readonly Named[]): string {
  const [first] = exported;
  if (first === undefined) return '';
  const more = exported.length > 1 ? ` and ${exported.length - 1} more` : '';
  return `${first.at}:${first.line}${more}`;
}

/** One use the source index resolved, with the specifier its file wrote. */
export type IndexedUse = Taken & {
  readonly specifier: string;
  /** The lines of the importing file that use what the import binds; absent for a member read, which binds nothing. */
  readonly lines?: readonly number[];
};

/**
 * A namespace one file passes a name on inside: `export * as shout` passes
 * `greet` as `shout.greet`, `name` `shout` and `members` `['greet']`.
 */
export interface PassedInside {
  readonly at: string;
  readonly name: string;
  readonly members: readonly string[];
}

/**
 * What the source index says about the imports of one name out of a set of
 * files: each use with the name it takes, every file that passes the name on
 * with `export … from`, every namespace one passes it on inside, and each line
 * of one of the files that uses the name it declares there; or why it could
 * not be read.
 */
export type Within =
  | {
    readonly uses: readonly IndexedUse[];
    readonly through: readonly string[];
    readonly namespaces: readonly PassedInside[];
    readonly inFile: readonly Use[];
  }
  | { readonly unread: string };

/**
 * Every import of `name` out of one of `files`, or out of a file that passes it
 * on from one, read off the source index of `root`, or why that index says
 * nothing: no checkout named, none published, or one that does not read.
 */
export function importsOf(root: string | undefined, files: readonly string[], name: string): Within {
  const read = importers(root, [files.map((file) => ({ file, name }))]);
  if ('unread' in read) return read;
  const inFile = read.inFile.map((use): Use => ({ at: use.at, line: use.line, by: use.by, kind: use.kind, type: false }));
  const [asked] = read.groups;
  if (asked === undefined) return { unread: 'the source index answered no group for the one asked' };
  return { uses: asked.uses.map(indexedUse), through: asked.through, namespaces: read.namespaces, inFile };
}

/** The native answer to who imports each asked name out of its file, one question per group, or why the index says nothing. */
function importers(root: string | undefined, asked: readonly (readonly Asked[])[]): NonNullable<ReturnType<typeof importersOf>> | { readonly unread: string } {
  if (root === undefined) return { unread: 'this host named no checkout to read the source index of' };
  let read: ReturnType<typeof importersOf>;
  try {
    read = importersOf(root, asked);
  } catch (error) {
    return { unread: `${error instanceof Error ? error.message : String(error)}; run \`variance index\`` };
  }
  return read ?? { unread: 'no source index is published; run `variance index`' };
}

function indexedUse(use: NonNullable<ReturnType<typeof importersOf>>['groups'][number]['uses'][number]): IndexedUse {
  return { name: use.name, specifier: use.key, ...useOf(use), ...(use.lines == null ? {} : { lines: use.lines }) };
}

/** One file asked who imports a name out of it, and the name it exports it under. */
export type Asked = { readonly file: string; readonly name: string };

/** What the source index says one file asked about answers alone: its uses and the files passing it on, or why it could not be read. */
export type Apart = { readonly uses: readonly IndexedUse[]; readonly through: readonly string[] } | { readonly unread: string };

/**
 * `importsOf` for each asked file and name apart, in the order asked, read in
 * one walk: the imports of the name out of that file, or a file passing it on
 * from it, and the files passing it on, that file left out.
 */
export function importsApart(root: string | undefined, asked: readonly Asked[]): readonly Apart[] {
  const read = importers(root, asked.map((one) => [one]));
  if ('unread' in read) return asked.map(() => read);
  return read.groups.map((one) => ({ uses: one.uses.map(indexedUse), through: one.through }));
}

/** The refusal when the imports cannot be read: the export is known, the index that holds its importers is not. */
export function indexMissing(name: string, exported: readonly Named[], unread: string): string {
  return `\`${name}\` is exported, without being published, at ${exportedAt(exported)}; who imports it is read from the source index, and ${unread}.`;
}
