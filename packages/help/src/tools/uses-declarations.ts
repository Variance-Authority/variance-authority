/**
 * The declarations `docs_uses` answers for: every file that declares the name,
 * published, exported or kept to itself, each one another thing, and the one a
 * `file` input names when it names one.
 */

// compass: variance-authority.report.agent-surface

import type { Spelling } from '@variance-authority/mcp/tools';
import type { DeclaredName } from '@variance-authority/sense';
import { reachSentences } from './declared.js';
import { specifierOf } from './find.js';
import { type Members, places } from './members.js';
import { exportedAt } from './unpublished.js';
import type { Namesake } from './uses-of.js';

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
export function namesakeLine(name: string, one: Pick<Namesake, 'published' | 'exported'>): string {
  const [door] = one.published;
  if (door === undefined) return `\`${name}\` is exported, without being published, at ${exportedAt(one.exported)} as well, which is another declaration.`;
  const by = one.published.map(([held, opening]) => specifierOf(held, opening)).join(', ');
  return `\`${name}\` is published by ${by}, declared at ${door[2].at}:${door[2].line} as well, which is another declaration.`;
}

/** How to ask for one declaration, said when the answer covers more than one and no file was named. */
export function narrowing(files: readonly string[], file: string | undefined, spell: Spelling): readonly string[] {
  return file !== undefined || new Set(files).size < 2 ? [] : ['', `\`${spell.input('file')}\`, the file one of them is declared in, answers for that declaration alone.`];
}

/** The answer for a `file` that declares no thing by the name: the files that do. */
export function notDeclaredIn(name: string, file: string, files: readonly string[]): string {
  const sorted = [...new Set(files)].sort();
  const listed = sorted.length < 2 ? sorted.join('') : `${sorted.slice(0, -1).join(', ')} and ${sorted.at(-1)!}`;
  return `\`${name}\` is not declared in ${file}; it is declared in ${listed}.`;
}
