/**
 * The declarations part of `docs_orient`'s answer: what each file asked about
 * declares at its top level, from its parse in the source index.
 *
 * A reader handed a file wants its outline before its text: each name with the
 * line it is declared on, whether an export binds it, and, under a class, an
 * interface or a type alias, the members it holds, each as the line the index
 * recorded, through the rule `symbol` lists them by. The addon chose which rows fit the
 * line budget and counted the rest, the names a file only binds apart from its
 * declarations; this chooses the words and the order.
 */

// compass: variance-authority.report.agent-surface

import type { FileDeclaration, FileDeclarations } from '@variance-authority/sense';
import { memberLines } from './container.js';
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
  if (file.declarations.length === 0 && file.more === 0) return [`  ${file.file}  declares nothing at the top level`, ...left(file)];
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
    ...file.declarations.flatMap((declaration) => rows(file.file, declaration, wide)),
    ...left(file),
  ];
}

/** The line that counts what the budget cut from a file and the line that counts the names it only binds, each where there are any. */
function left(file: FileDeclarations): readonly string[] {
  const cut = [
    ...(file.more > 0 ? [plural(file.more, 'more top-level declaration')] : []),
    ...(file.moreMembers > 0 ? [plural(file.moreMembers, 'more member line')] : []),
  ];
  return [
    ...(cut.length > 0 ? [`    ${cut.join(' and ')} not shown.`] : []),
    ...(file.bound > 0 ? [`    ${plural(file.bound, 'name')} it binds and does not declare not shown.`] : []),
  ];
}

function rows(file: string, declaration: FileDeclaration, wide: number): readonly string[] {
  const under = `    ${' '.repeat(wide)}  `;
  return [
    `    ${String(declaration.line).padStart(wide)}  ${declaration.exported === true ? 'exported ' : ''}${declaration.kind} ${declaration.name}`,
    // The row above names the declaration and does not show its line, so no
    // line is shown already: a member on the container's line shows that line.
    ...memberLines(file, declaration.members, []).map((member) => `${under}${String(member.line).padStart(wide)}  ${member.text}`),
  ];
}
