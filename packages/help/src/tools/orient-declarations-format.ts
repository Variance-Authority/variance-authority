/**
 * The declarations part of `docs_orient`'s answer: what each file asked about
 * declares at its top level, from its parse in the source index.
 *
 * A reader handed a file wants its outline before its text: each name with the
 * line it is declared on, whether an export binds it, and, under a class, an
 * interface or a type alias, the members it holds, each as the line the index
 * recorded, the way `symbol` lists them. The addon chose which rows fit the
 * line budget and counted the rest; this chooses the words and the order.
 */

// compass: variance-authority.report.agent-surface

import type { FileDeclaration, FileDeclarations } from '@variance-authority/sense';
import { plural } from './format.js';
import { membersNotReadIn } from './members.js';

/** The declarations part, or nothing when no file asked about is in the index. */
export function formatDeclarations(files: readonly FileDeclarations[] | undefined): readonly string[] {
  if (files === undefined || files.length === 0) return [];
  return ['', 'Declared at the top level, from the source index:', ...files.flatMap(outline)];
}

function outline(file: FileDeclarations): readonly string[] {
  // Absent is not empty: a file whose declarations were not read may declare anything.
  if (!file.read) return [`  ${file.file}  the index holds no parse of its declarations`];
  if (file.declarations.length === 0 && file.more === 0) return [`  ${file.file}  declares nothing at the top level`];
  const notes = [
    ...(file.declarations.some((declaration) => declaration.exported === undefined || declaration.exported === null)
      ? ['the index kept no exports of it, so none is marked exported']
      : []),
    ...[membersNotReadIn(file.file)].filter((note) => note !== undefined),
  ];
  const lines = file.declarations.flatMap((declaration) => [declaration.line, ...declaration.members.map((member) => member.line)]);
  const wide = String(Math.max(1, ...lines)).length;
  return [
    `  ${file.file}${notes.map((note) => `  (${note})`).join('')}`,
    ...file.declarations.flatMap((declaration) => rows(declaration, wide)),
    ...[left(file)].filter((line) => line !== undefined),
  ];
}

/** The one line that counts what the budget cut from a file, or nothing when it cut nothing. */
function left(file: FileDeclarations): string | undefined {
  const cut = [
    ...(file.more > 0 ? [plural(file.more, 'more top-level declaration')] : []),
    ...(file.moreMembers > 0 ? [plural(file.moreMembers, 'more member')] : []),
  ];
  return cut.length === 0 ? undefined : `    ${cut.join(' and ')} not shown.`;
}

function rows(declaration: FileDeclaration, wide: number): readonly string[] {
  const under = `    ${' '.repeat(wide)}  `;
  return [
    `    ${String(declaration.line).padStart(wide)}  ${declaration.exported === true ? 'exported ' : ''}${declaration.kind} ${declaration.name}`,
    // A member that shares its line with the container or the member before it
    // is named, so a one-line type does not print its line once per member.
    ...declaration.members.map((member, at) => {
      const shared = member.line === (at === 0 ? declaration.line : declaration.members[at - 1]?.line);
      return `${under}${String(member.line).padStart(wide)}  ${shared ? member.name : (member.text?.trim() ?? member.name)}`;
    }),
  ];
}
