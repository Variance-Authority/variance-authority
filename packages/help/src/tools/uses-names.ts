/**
 * What a name names, past the one declaration `docs_uses` answers by its imports.
 *
 * A name is how the asker spells a declaration, and one name can be several:
 * an export, a member of an interface elsewhere, a function another file keeps
 * to itself. Each is answered on its own, so the answer opens by naming every
 * one, and none is picked in silence.
 *
 * A name an installed package declares has its declaration outside the
 * checkout and every import of it inside: a request the scan did not resolve
 * to a file, out of a package the importing file's record names and no
 * manifest of the workspace declares. Those imports are the answer, and
 * `docs_symbol` holds the declaration, read from the package.
 *
 * A Rust item JavaScript reaches through a native binding is imported by no
 * JavaScript file: the binding hands it over under the name its JavaScript
 * side declares, and which name that is is not read. The answer says so
 * rather than reading as *nothing uses it*.
 */

// compass: variance-authority.report.agent-surface

import { notShown } from '@variance-authority/mcp/tools';
import type { Documented, Entry, Named, Opening, Use } from '@variance-authority/package/help';
import { type DeclaredName, languageOf, thirdPartyImportersOf } from '@variance-authority/sense';
import { useOf } from '../refresh-native.js';
import { ownerOf } from './by-path.js';
import { unreadLine } from './declared.js';
import { places } from './members.js';
import { type Site, kinds } from './sites.js';
import { indexed } from './unpublished.js';

/**
 * The imports of a name out of packages the workspace installs, those
 * packages, and the files whose imports were not read; or why the index was
 * not read.
 */
export type Outside =
  | {
      readonly sites: readonly Site[];
      readonly packages: readonly string[];
      /** The `file:line` of each site that is an `export … from`, which passes the name on. */
      readonly passing: readonly string[];
      readonly notRead: readonly string[];
    }
  | { readonly unread: string };

/**
 * Every import of `name` out of a package no manifest of the workspace
 * declares, read off the source index of `root`, narrowed to `wanted` when it
 * names a package or one of its specifiers. An `export … from` is listed as
 * the import it is, marked as passing the name on.
 */
export function outsideOf(root: string | undefined, name: string, wanted: string | undefined): Outside {
  const answer = indexed(root, (checkout) => thirdPartyImportersOf(checkout, name));
  if ('unread' in answer) return answer;
  const { read } = answer;
  const owner = wanted === undefined ? undefined : ownerOf(wanted);
  const taken = read.uses.filter(({ package: of, site }) => owner === undefined || (of === owner && (wanted === owner || site.key === wanted)));
  const sites = taken.map(({ package: of, passesOn, site }): Site => {
    const from = `from ${of}${passesOn ? ', passes it on' : ''}`;
    return { ...useOf(site), name: site.name, by: site.by === '' ? from : `${site.by}, ${from}` };
  });
  const passing = taken.filter((one) => one.passesOn).map(({ site }) => `${site.at}:${site.line}`);
  return { sites, packages: [...new Set(taken.map((one) => one.package))].sort(), passing, notRead: read.unread };
}

/** How many files whose imports were not read `importsUnread` names before it counts the rest. */
const NOT_READ_NAMED = 3;

/**
 * The sentence that names the files the source index holds and whose imports
 * it could not read, any of which may import the name out of an installed
 * package; nothing when every file's were read.
 */
export function importsUnread(outside: Outside): readonly string[] {
  if (!('notRead' in outside) || outside.notRead.length === 0) return [];
  const { notRead } = outside;
  const files = notRead.length === 1 ? '1 file' : `${notRead.length} files`;
  const more = notRead.length - NOT_READ_NAMED;
  const named = `${notRead.slice(0, NOT_READ_NAMED).join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
  return [`The imports of ${files} were not read, so an import of it there out of an installed package is not known: ${named}.`];
}

/** What the workspace declares under one name, as `usesOf` read it. */
export interface Carried {
  readonly name: string;
  readonly found: readonly (readonly [Documented, Opening, Entry])[];
  readonly exported: readonly Named[];
  readonly kept: readonly DeclaredName[];
  readonly members: readonly Use[];
}

/**
 * Every declaration that carries the name, one to a line, when there is more
 * than one: what each is and where, and each package outside the workspace
 * the name is imported from. Nothing when the name is one declaration.
 */
export function carriers(carried: Carried, outside: Outside, limit: number): readonly string[] {
  const { name, found, kept, members } = carried;
  const packages = 'sites' in outside ? outside.packages : [];
  // An `export … from` out of an installed package passes on that package's declaration, counted once as it.
  const passing = new Set('sites' in outside ? outside.passing : []);
  const exported = carried.exported.filter((one) => !passing.has(`${one.at}:${one.line}`));
  const published = new Map(found.map(([, , entry]) => [`${entry.at}:${entry.line}`, `${entry.kind}, published, at ${entry.at}:${entry.line}`]));
  // An `export … from` passes on a declaration of another file, which is not another one.
  const declaring = exported.filter((one) => one.declaration !== undefined);
  const exports = (declaring.length > 0 ? declaring : exported).map((one) => `${one.declaration ?? 'export'}, exported, at ${one.at}:${one.line}`);
  const declarations = [
    ...published.values(),
    ...exports,
    ...kept.map((one) => `${one.kind}, declared, not exported, at ${one.at}:${one.line}`),
    ...members.map((one) => `member of \`${one.by}\` at ${one.at}:${one.line}`),
  ];
  const lines = [...declarations, ...packages.map((owner) => `imported from ${owner}, which declares it outside the workspace`)];
  if (lines.length < 2) return [];
  const shown = lines.slice(0, limit);
  return [
    `\`${name}\` ${carrying(declarations.length, packages.length)}, each answered below:`,
    ...shown.map((line) => `  ${line}`),
    ...(lines.length > shown.length ? [`  … ${notShown(lines.length - shown.length)}`] : []),
    '',
  ];
}

/** What carries a name, counted: the workspace's declarations of it, and the installed packages it is imported from. */
function carrying(declared: number, packages: number): string {
  const of = (count: number, one: string): string => `${count} ${one}${count === 1 ? '' : 's'}`;
  const imported = `is imported from ${of(packages, 'installed package')}`;
  if (declared === 0) return imported;
  const names = `names ${of(declared, 'declaration')}`;
  return packages === 0 ? names : `${names} and ${imported}`;
}

/** What may hold a declaration of the name in the workspace and was not read. */
export interface Unread {
  /** The files whose declarations the source index does not hold. */
  readonly declarations: readonly string[];
  /** Why the members by the name were not read, when they were not. */
  readonly members: string | undefined;
}

/**
 * The imports of a name out of packages the workspace installs: the whole
 * answer when `alone`, else after the workspace's. Alone, the answer ends with
 * what of the workspace was not read and may declare the name, `unread`.
 */
export function outsideLines(name: string, outside: Outside, alone: boolean, from: string | undefined, limit: number, unread: Unread): readonly string[] {
  if (!('sites' in outside) || outside.sites.length === 0) return [];
  const { sites, packages } = outside;
  const out = packages.join(', ');
  const notRead = importsUnread(outside);
  if (!alone) {
    return ['', `\`${name}\` is imported from outside the workspace too, in ${places(sites.length)}, out of ${out}:`, ...kinds(sites, from, name, limit), ...(notRead.length === 0 ? [] : ['', ...notRead])];
  }
  const nearest = from === undefined ? 'Path order; `from` sorts nearest first.' : `Nearest to ${from} first.`;
  const read = unread.declarations.length === 0 ? '' : ' that the source index read';
  return [
    `\`${name}\` is declared in no file of this workspace${read}; it is imported from outside it in ${places(sites.length)}, out of ${out}.`,
    nearest,
    ...kinds(sites, from, name, limit),
    '',
    'docs_symbol has its declaration in each package.',
    ...notRead,
    ...unreadLine(unread.declarations),
    ...(unread.members === undefined ? [] : [`Members by this name were not read: ${unread.members}.`]),
  ];
}

/** The sentence that names what a Rust declaration's answer cannot follow, when one of `at` is a Rust file. */
export function bindingLines(at: readonly string[]): readonly string[] {
  if (!at.some((file) => languageOf(file) === 'rust')) return [];
  return [
    '',
    "A use from JavaScript through a native binding (napi, wasm-bindgen) imports no Rust name, and which name a binding gives a Rust item is not read, so those uses are not listed; ask for the name the binding's JavaScript side declares.",
  ];
}
