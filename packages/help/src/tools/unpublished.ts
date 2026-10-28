/**
 * Names a file exports and no entry publishes, answered rather than refused.
 *
 * Exported for a neighbour and never published is most of any repository. A
 * caller who typed such a name exactly is not wrong about the name, only about
 * the door: `symbol` says where it is declared, and `uses` lists who imports it.
 *
 * The Help value records the imports that cross a package, and an import within
 * one is most of what an unpublished name has, so who imports such a name is
 * read off the source index, in `indexed-imports.ts`.
 */

// compass: variance-authority.report.agent-surface

import type { Help, Named } from '@variance-authority/package/help';
import { importsByPath } from './by-path.js';

/** What an import count leaves out: a use that names the export without importing it. */
export const UNCOUNTED = 'a namespace imported by name that goes somewhere whole and, outside Rust, a call through a qualified path are not counted';

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

/** The refusal when the imports cannot be read: the export is known, the index that holds its importers is not. */
export function indexMissing(name: string, exported: readonly Named[], unread: string): string {
  return `\`${name}\` is exported, without being published, at ${exportedAt(exported)}; who imports it is read from the source index, and ${unread}.`;
}
