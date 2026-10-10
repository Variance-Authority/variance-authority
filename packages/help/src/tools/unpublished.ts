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
 * an import counts when it resolved to a file that exports the name.
 */

// compass: variance-authority.report.agent-surface

import type { Help, Named, Use } from '@variance-authority/package/help';
import { importersOf } from '@variance-authority/sense';
import { useOf } from '../refresh-native.js';
import { importsByPath } from './by-path.js';

/** What an import count leaves out: a use that names the export without importing it. */
export const UNCOUNTED = 'an import through an `export *` file and a call through a qualified path are not counted';

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
 * path spells, with or without an extension or an `index`.
 */
function fileOf(help: Help, held: Named, within: string): boolean {
  if (!within.startsWith(`${held.by}/`)) return false;
  const resolved = importsByPath(help, within).flatMap(([deep]) => (deep.specifier === within && deep.to !== undefined ? [deep.to] : []));
  if (resolved.length > 0) return resolved.includes(held.at);
  const spelled = bare(within.slice(held.by.length + 1));
  const file = bare(held.at);
  return file.endsWith(`/${spelled}`) || file.endsWith(`/${spelled}/index`);
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

/**
 * Every import of `name` out of a file in `exported`, read off the source index
 * of `root`; `undefined` when no index is published.
 */
export function importsOf(root: string, exported: readonly Named[], name: string): readonly Use[] | undefined {
  const found = importersOf(root, [...new Set(exported.map((held) => held.at))], name);
  return found?.map(useOf);
}

/** Why the source index cannot say who imports an export. */
export function indexUnread(root: string | undefined): string {
  return root === undefined
    ? 'this host named no checkout to read the source index of'
    : 'no source index is published; run `variance index`';
}

/** The refusal when the imports cannot be read: the export is known, the index that holds its importers is not. */
export function indexMissing(name: string, exported: readonly Named[], root: string | undefined): string {
  return `\`${name}\` is exported, without being published, at ${exportedAt(exported)}; who imports it is read from the source index, and ${indexUnread(root)}.`;
}
