/**
 * A name an import renames, answered in both directions.
 *
 * `import { stringReader as openStrings } from './strings.js'` binds
 * `openStrings` in its file to the export `stringReader` of the file the
 * request resolves to. The binding the parse recorded is the one fact that ties
 * the two names, so `symbol` asked for `openStrings` reads the binding and
 * answers the export it names, and asked for `stringReader` says which files
 * know it as something else. Nothing is related by how a name is spelled.
 */

// compass: variance-authority.report.agent-surface

import type { Help, Use } from '@variance-authority/package/help';
import { aliasesOf, type Alias } from '@variance-authority/sense';
import { queryDependencyLexicon } from '../dependency-lexicon.js';
import { entriesNamed, isPackage, specifierOf } from './find.js';
import { block } from './format.js';
import { thirdBlock } from './third-party.js';

/** How many renamed sites are worth naming on one line. */
const CAP = 12;

/**
 * The line naming every site of `name` its file knows by another name: the one
 * its import binds it to with `as`, or else the one a re-export renamed it to.
 * Nothing when every site keeps the name.
 */
export function renamedSites(name: string, sites: readonly (Use & { readonly name?: string })[]): readonly string[] {
  const seen = new Set<string>();
  const renamed: string[] = [];
  const ordered = [...sites].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0) || a.line - b.line);
  for (const site of ordered) {
    const known = site.local ?? site.name;
    const key = `${site.at}:${site.line}`;
    if (known === undefined || known === name || seen.has(key)) continue;
    seen.add(key);
    renamed.push(`${key} as \`${known}\``);
  }
  if (renamed.length === 0) return [];
  return [`Imported under another name: ${renamed.slice(0, CAP).join(', ')}${more(renamed.length)}.`];
}

/** What a list cut at `CAP` leaves out. */
function more(count: number): string {
  return count > CAP ? `, and ${count - CAP} more` : '';
}

/** One original an import binds under another name, and where it is declared when that is known. */
interface Original {
  readonly text: string;
  readonly at?: readonly [string, number];
}

/**
 * What `symbol` says about `local` as a name imports bind: for each export it
 * names, the imports that rename it and the export itself, and the files and
 * lines that declare both. `wanted` keeps the exports of that package. Nothing
 * when no import binds `local` to another name, or no source index is read.
 */
export function localNames(
  help: Help,
  root: string | undefined,
  local: string,
  wanted: string | undefined,
): { readonly blocks: readonly string[]; readonly files: readonly (readonly [string, number])[] } {
  if (root === undefined) return { blocks: [], files: [] };
  let aliases: readonly Alias[] | undefined;
  try {
    aliases = aliasesOf(root, local);
  } catch {
    // An index that does not read answers nothing here; the question's other readings say why.
    return { blocks: [], files: [] };
  }
  // The imports that name one export: the same imported name out of the same resolved file, or the same specifier when none resolved.
  const groups = new Map<string, Alias[]>();
  for (const alias of aliases ?? []) {
    const key = `${alias.imported}\u0000${alias.to ?? `\u0000${alias.specifier}`}`;
    groups.set(key, [...(groups.get(key) ?? []), alias]);
  }
  const blocks: string[] = [];
  const files: (readonly [string, number])[] = [];
  for (const group of groups.values()) {
    const [first] = group;
    if (first === undefined) continue;
    const original = originalOf(help, root, first, wanted);
    if (original === undefined) continue;
    const imports = (alias: Alias): string =>
      `${alias.at}:${alias.line} imports \`${alias.imported}\` as \`${local}\` from '${alias.specifier}'${alias.type ? ' (type only)' : ''}`;
    const also = group.slice(1);
    blocks.push([
      `\`${local}\` is a local name: ${imports(first)}.`,
      ...(also.length === 0 ? [] : [`Also imported as \`${local}\` at ${also.slice(0, CAP).map((alias) => `${alias.at}:${alias.line}`).join(', ')}${more(also.length)}.`]),
      '',
      original.text,
    ].join('\n'));
    files.push(...group.map((alias) => [alias.at, alias.line] as const));
    if (original.at !== undefined) files.push(original.at);
  }
  return { blocks, files };
}

/**
 * The export one import names: the published entry its specifier opens, the
 * export of the file the index resolved it to, or the installed declaration
 * its specifier names. Said as unknown, not left out, when none answers.
 * `undefined` when `wanted` names another package.
 */
function originalOf(help: Help, root: string, alias: Alias, wanted: string | undefined): Original | undefined {
  const name = alias.imported;
  const door = entriesNamed(help, name).find(([published, held]) => specifierOf(published, held) === alias.specifier);
  if (door !== undefined) {
    const [published, held, entry] = door;
    if (wanted !== undefined && !isPackage(published, held, wanted)) return undefined;
    return { text: block(published, held, entry), at: [entry.at, entry.line] };
  }
  const to = alias.to ?? undefined;
  if (to !== undefined) {
    const held = help.exported.find((one) => one.name === name && one.at === to);
    if (held !== undefined) {
      if (wanted !== undefined && held.by !== wanted) return undefined;
      return {
        text: `${name}\nexported, without being published, at ${held.at}:${held.line} by ${held.by}${held.type ? ' (type only)' : ''}`,
        at: [held.at, held.line],
      };
    }
  }
  const installed = queryDependencyLexicon(root, name, [alias.at], true, wanted, 100)?.shown.filter((match) => match.specifier === alias.specifier) ?? [];
  if (installed.length > 0) return { text: installed.map(thirdBlock).join('\n\n') };
  if (wanted !== undefined) return undefined;
  return {
    text: to === undefined
      ? `Where \`${name}\` is declared is not known: the source index did not resolve '${alias.specifier}' to a file.`
      : `Where \`${name}\` is declared is not known: ${to} exports no \`${name}\` this reading holds.`,
  };
}
