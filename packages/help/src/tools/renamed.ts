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

import { codeUnitOrder } from '@variance-authority/core/segment';
import { type Help, type Use, undecided } from '@variance-authority/package/help';
import { aliasesOf, type Alias } from '@variance-authority/sense';
import { queryDependencyLexicon } from '../dependency-lexicon.js';
import { entriesNamed, isPackage, specifierOf } from './find.js';
import { memberRows } from './container.js';
import { block } from './format.js';
import { keyOf, SLOT } from './declaration-key.js';
import { exportedRows } from './passed-on.js';
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
  const ordered = [...sites].sort((a, b) => codeUnitOrder(a.at, b.at) || a.line - b.line);
  for (const site of ordered) {
    const known = site.local ?? site.name;
    if (known === undefined || known === name) continue;
    const said = `${site.at}:${site.line} as \`${known}\``;
    if (seen.has(said)) continue;
    seen.add(said);
    renamed.push(said);
  }
  if (renamed.length === 0) return [];
  return [`Imported under another name: ${renamed.slice(0, CAP).join(', ')}${more(renamed.length)}.`];
}

/** What a list cut at `CAP` leaves out. */
function more(count: number): string {
  return count > CAP ? `, and ${count - CAP} more` : '';
}

/** One original an import binds under another name, and the lines of the checkout that export and declare it, when they are known. */
interface Original {
  readonly text: string;
  readonly at: readonly (readonly [string, number])[];
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
    // `import greet from` a file exporting `greet` as `default` too binds the declaration by its own name: no local name.
    const held = first.to == null ? undefined : help.exported.find((one) => one.at === first.to && one.name === first.imported);
    const declared = held === undefined ? undefined : keyOf(help, root, held).named;
    if (declared === local) continue;
    // The slot `default` is said by the name its declaration is keyed by.
    const named = first.imported === SLOT ? (declared ?? first.imported) : first.imported;
    const original = originalOf(help, root, first, wanted, named);
    if (original === undefined) continue;
    const imports = (alias: Alias): string =>
      `${alias.at}:${alias.line} imports \`${named}\`${named === alias.imported ? '' : ` (its \`${alias.imported}\`)`} as \`${local}\` from '${alias.specifier}'${alias.type ? ' (type only)' : ''}`;
    const also = group.slice(1);
    blocks.push([
      `\`${local}\` is a local name: ${imports(first)}.`,
      ...(also.length === 0 ? [] : [`Also imported as \`${local}\` at ${also.slice(0, CAP).map((alias) => `${alias.at}:${alias.line}`).join(', ')}${more(also.length)}.`]),
      '',
      original.text,
    ].join('\n'));
    files.push(...group.map((alias) => [alias.at, alias.line] as const));
    files.push(...original.at);
  }
  return { blocks, files };
}

/**
 * The export one import names: the published entry its specifier opens or
 * that the file the index resolved it to declares, the export of that file
 * when no entry publishes it, followed to the declaration it passes on with
 * `export … from`, or the installed declaration its specifier names. The
 * members of an interface, a type alias or a class follow the declaration.
 * Said as unknown, not left out, when none answers.
 * `undefined` when `wanted` names another package.
 */
function originalOf(help: Help, root: string, alias: Alias, wanted: string | undefined, said: string): Original | undefined {
  const name = alias.imported;
  const named = entriesNamed(help, name);
  // An import across packages names the entry by its specifier; one within the package names the file, which the index resolved.
  const door =
    named.find(([published, held]) => specifierOf(published, held) === alias.specifier) ??
    (alias.to == null ? undefined : named.find(([, , entry]) => entry.at === alias.to));
  if (door !== undefined) {
    const [published, held, entry] = door;
    if (wanted !== undefined && !isPackage(published, held, wanted)) return undefined;
    // The original's own sites are not read here, so the entry's are what may read it.
    const may = undecided(published.name, held, entry);
    return { text: [block(published, held, entry, { may, imported: false }), ...memberRows(root, entry.at, entry.name, entry.line)].join('\n'), at: [[entry.at, entry.line]] };
  }
  const to = alias.to ?? undefined;
  if (to !== undefined) {
    const held = help.exported.find((one) => one.name === name && one.at === to);
    if (held !== undefined) {
      if (wanted !== undefined && held.by !== wanted) return undefined;
      const { declared, rows } = exportedRows(help, root, said, held);
      return {
        text: [
          ...rows,
          ...memberRows(root, declared.at, declared.name, declared.line),
        ].join('\n'),
        at: [[held.at, held.line], ...(declared === held ? [] : [[declared.at, declared.line] as const])],
      };
    }
  }
  const installed = queryDependencyLexicon(root, name, [alias.at], true, wanted, 100)?.shown.filter((match) => match.specifier === alias.specifier) ?? [];
  if (installed.length > 0) return { text: installed.map(thirdBlock).join('\n\n'), at: [] };
  if (wanted !== undefined) return undefined;
  return {
    text: to === undefined
      ? `Where \`${name}\` is declared is not known: the source index did not resolve '${alias.specifier}' to a file.`
      : `Where \`${name}\` is declared is not known: ${to} exports no \`${name}\` this reading holds.`,
    at: [],
  };
}
