/**
 * The two parts of `docs_orient`'s answer read off each asked file's parse in
 * the source index: the declarations each line asked about is in, and what
 * each file declares at its top level.
 *
 * A line is answered by the declarations whose first and last lines enclose
 * it, outermost first, as an editor's breadcrumb names them; a line in none is
 * at the top level of the module. The parse answers it whether or not a case
 * ran the line: the journeys part adds the cases that did.
 *
 * A reader handed a file wants its outline before its text: each name with the
 * line it is declared on, whether an export binds it, and, under a class, an
 * interface or a type alias, the members it holds, each as the line the index
 * recorded, through the rule `symbol` lists them by. The addon chose which rows fit the
 * line budget and counted the rest, the names a file only binds apart from its
 * declarations; this chooses the words and the order.
 */

// compass: variance-authority.report.agent-surface

import type { FileDeclaration, FileDeclarations, LineHeld } from '@variance-authority/sense';
import { memberLines } from './container.js';
import { linesOf, plural } from './format.js';
import { memberlessLanguageOf, membersNotReadIn } from './members.js';

/** The lines part, or nothing when no line asked about is in a file the index holds. */
export function formatLines(lines: readonly LineHeld[] | undefined): readonly string[] {
  if (lines === undefined || lines.length === 0) return [];
  const asked = lines.map((held) => `${held.file}:${held.line}`);
  const wide = Math.max(...asked.map((spelled) => spelled.length));
  return ['', 'Lines asked about, from the source index:', ...lines.map((held, at) => `  ${asked[at]!.padEnd(wide)}  ${heldBy(held)}`)];
}

function heldBy(held: LineHeld): string {
  // Absent is not empty: the line of a file whose declarations were not read may be in any of them.
  if (!held.read) return 'the index holds no parse of its declarations';
  const innermost = held.holders[held.holders.length - 1];
  if (innermost !== undefined) return `in ${held.holders.map((holder) => `${holder.kind} ${holder.name}`).join(' > ')} (${linesOf(innermost)})`;
  const language = memberlessLanguageOf(held.file);
  // The line of a file whose members the scan does not record may be in one, so it is not called the top level.
  return language === undefined
    ? 'at the top level of the module'
    : `in none of the declarations the index records; members are read from JavaScript and TypeScript only, so it may be in a member of this ${language} file`;
}

/** The declarations part, or nothing when no file asked about is in the index. */
export function formatDeclarations(files: readonly FileDeclarations[] | undefined): readonly string[] {
  if (files === undefined || files.length === 0) return [];
  return ['', 'Declared at the top level, from the source index:', ...files.flatMap(outline)];
}

function outline(file: FileDeclarations): readonly string[] {
  // Absent is not empty: a file whose declarations were not read may declare anything.
  if (!file.read) return [`  ${file.file}  the index holds no parse of its declarations`];
  // The names counted as bound are not known to be exported, so a file that only binds says when that is unknown.
  const unmarked = file.exportsKept ? [] : ['the index kept no exports of it, so none is marked exported'];
  if (file.declarations.length === 0 && file.more === 0) {
    const notes = file.bound > 0 ? unmarked : [];
    return [`  ${file.file}  declares nothing at the top level${notes.map((note) => `  (${note})`).join('')}`, ...left(file)];
  }
  const notes = [
    ...unmarked,
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
    ...(file.bound > 0 ? [`    Not listed: ${plural(file.bound, 'name')} it binds and does not declare.`] : []),
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
