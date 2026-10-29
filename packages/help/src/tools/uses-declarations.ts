/**
 * The declarations `docs_uses` answers for: every file that declares the name,
 * published, exported or kept to itself, each one another thing, and the one a
 * `file` input names when it names one.
 */

// compass: variance-authority.report.agent-surface

import { conjoined, spellingOf, type Spelling } from '@variance-authority/mcp/tools';
import type { DeclaredName } from '@variance-authority/sense';
import { reachSentences } from './declared.js';
import { discover } from './discover.js';
import { specifierOf } from './find.js';
import { type Members, places } from './members.js';
import { SLOT } from './declaration-key.js';
import { exportedAt } from './unpublished.js';
import type { Namesake, PublishedDeclaration } from './uses-of.js';

/** The file the asker names a declaration by, exactly as the checkout spells it; absent when none is named. */
export function declaredIn(input: Readonly<Record<string, unknown>>): string | undefined {
  const file = input['file'];
  return typeof file === 'string' && file !== '' ? file : undefined;
}

/** Kinds in brackets after a name, each once and sorted; nothing when none is held. */
export function bracketed(held: readonly (string | undefined)[]): string {
  const kinds = [...new Set(held.filter((kind) => kind !== undefined))].sort();
  return kinds.length === 0 ? '' : ` [${kinds.join(', ')}]`;
}

/**
 * A name its files keep to themselves: what each declaration is, where it is
 * declared, and who can reach it from there. The kind is said every time,
 * since a name is not a thing: a Rust `mod walk;` and the `fn walk` inside it
 * are two declarations that share a spelling, and the export of one is no
 * answer about the other.
 */
export function keptLine(name: string, kept: readonly DeclaredName[], spell: Spelling): string {
  // A Rust item inside an inline module answers to its own name, and is
  // declared on its module path: the path is said where it is not the name.
  const named = (one: DeclaredName): string => (one.name === name ? '' : ` as \`${one.name}\``);
  const kind = (one: DeclaredName): string => bracketed([one.kind]);
  if (kept.length === 1) {
    const one = kept[0]!;
    return `\`${name}\`${kind(one)} is declared, not exported, at ${one.at}:${one.line}${named(one)}${reachSentences(one, spell).clause}.`;
  }
  const files = new Set(kept.map((one) => one.at)).size;
  return [
    `\`${name}\` is declared, not exported, in ${files === kept.length ? `${files} files` : places(kept.length)}:`,
    ...kept.map((one) => `  ${one.at}:${one.line}${named(one)}${kind(one)}${reachSentences(one, spell).clause}`),
  ].join('\n');
}

/** The member declarations in `file`, with their uses. */
export function membersIn(members: Members, file: string): Members {
  return { ...members, declared: members.declared.filter((one) => one.at === file), used: members.used.filter((one) => one.declared.at === file) };
}

/**
 * The sentence naming a namesake of the declaration answered first: by the
 * entries that publish it and where it is declared, or by the exports that
 * reach it when no entry publishes it.
 */
export function namesakeLine(name: string, one: Pick<Namesake, 'declaration' | 'exported'>): string {
  if (one.declaration === undefined) return `\`${name}\` is exported, without being published, at ${exportedAt(one.exported)} as well, which is another declaration.`;
  return `\`${name}\` is ${publishedAt(one.declaration, name)} as well, which is another declaration.`;
}

/**
 * The entries that publish one declaration and where it is declared, which
 * tells it from a namesake. A door that publishes it under another name than
 * `asked` says that name, and so does a file that declares it by another.
 */
export function publishedAt(one: PublishedDeclaration, asked: string): string {
  const as = (spelled: string): string => (spelled === asked ? '' : spelled === SLOT ? ' as its default' : ` as \`${spelled}\``);
  const by = one.doors.map(([held, opening, entry]) => `${specifierOf(held, opening)}${as(entry.name)}`).join(', ');
  return `published by ${by}, declared${as(one.declared)} at ${one.at}:${one.line}`;
}

/** Whether a door publishes the declaration under another name than `asked`, or its file declares it by another. */
export function renamed(one: PublishedDeclaration, asked: string): boolean {
  return one.declared !== asked || one.doors.some(([, , entry]) => entry.name !== asked);
}

/** How to ask for one declaration, said when the answer covers more than one and no file was named. */
export function narrowing(files: readonly string[], file: string | undefined, spell: Spelling): readonly string[] {
  return file !== undefined || new Set(files).size < 2 ? [] : ['', `\`${spell.input('file')}\`, the file one of them is declared in, answers for that declaration alone.`];
}

/** The answer for a `file` that declares no thing by the name: the files that do. */
export function notDeclaredIn(name: string, file: string, files: readonly string[]): string {
  const sorted = [...new Set(files)].sort();
  return `\`${name}\` is not declared in ${file}; it is declared in ${conjoined(sorted)}.`;
}

/**
 * Where a name no file here declares is imported from, outside the workspace,
 * and the `discover` question that lists the files importing it from each of
 * `sources`: `uses` answers for a declaration of this workspace, and an
 * outside one is another question. Absent when `sources` is empty.
 */
export function outsideLine(name: string, sources: readonly string[], spell: Spelling): string | undefined {
  if (sources.length === 0) return undefined;
  // A wire host holds no scan's names, so `discover` there refuses `imports` of a package: the question is the checkout's.
  const wire = spell === spellingOf(undefined);
  const asked = wire ? spellingOf({ shell: 'variance ask' }) : spell;
  const questions = sources.map((source) => asked.question(discover, { imports: `${source}#${name}` }));
  return `\`${name}\` is imported from ${conjoined(sources.map((source) => `\`${source}\``))}, outside this workspace: ${conjoined(questions)}${wire ? ', asked in the checkout,' : ''} ${questions.length === 1 ? 'lists' : 'list'} the files that import it.`;
}
