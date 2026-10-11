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

import type { Help, Named, Taken } from '@variance-authority/package/help';
import { importersOf } from '@variance-authority/sense';
import { useOf } from '../refresh-native.js';
import { importsByPath } from './by-path.js';

/** What an import count leaves out: a use that names the export without importing it. */
export const UNCOUNTED = 'a read through an `export * as` namespace and a call through a qualified path are not counted';

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
 * Whether `within`, a specifier past `held`'s package name, names `held`'s file:
 * the file its imports resolved to, or, when nothing imports it, the file its
 * path spells, with or without an extension, and its `index` only when no file
 * of that name exports it, as a resolver tries the file first.
 */
function fileOf(help: Help, held: Named, within: string): boolean {
  if (!within.startsWith(`${held.by}/`)) return false;
  const resolved = importsByPath(help, within).flatMap(([deep]) => (deep.specifier === within && deep.to !== undefined ? [deep.to] : []));
  if (resolved.length > 0) return resolved.includes(held.at);
  const spelled = bare(within.slice(held.by.length + 1));
  const file = bare(held.at);
  const spells = (at: string): boolean => bare(at).endsWith(`/${spelled}`);
  if (spells(held.at)) return true;
  return (
    file.endsWith(`/${spelled}/index`) &&
    !help.exported.some((other) => other.name === held.name && other.by === held.by && spells(other.at))
  );
}

/** A path without its script extension. */
function bare(path: string): string {
  return path.replace(/\.[cm]?[jt]sx?$/, '');
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
 * files: each use with the name it takes, and every file that passes the name
 * on with `export … from`; or why it could not be read.
 */
export type Within =
  | { readonly uses: readonly IndexedUse[]; readonly through: readonly string[] }
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
  return { uses: read.uses.map((use) => ({ name: use.name, specifier: use.key, ...useOf(use) })), through: read.through };
}

/** The refusal when the imports cannot be read: the export is known, the index that holds its importers is not. */
export function indexMissing(name: string, exported: readonly Named[], unread: string): string {
  return `\`${name}\` is exported, without being published, at ${exportedAt(exported)}; who imports it is read from the source index, and ${unread}.`;
}
