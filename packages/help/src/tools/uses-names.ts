/**
 * What a name names, past the one declaration `docs_uses` answers by its imports.
 *
 * One name can be several declarations: an export, a member elsewhere, a
 * function another file keeps. The answer opens by naming every one, so none
 * is picked in silence. A name an installed package or a runtime module
 * declares is answered by the workspace's imports of it; the declaration is
 * `docs_symbol`'s. A Rust item JavaScript reaches through a native binding is
 * imported by no JavaScript file under its Rust name, and the answer says so
 * rather than reading as *nothing uses it*.
 */

// compass: variance-authority.report.agent-surface

import { notShown } from '@variance-authority/mcp/tools';
import type { Documented, Entry, Named, Opening, Use } from '@variance-authority/package/help';
import { type DeclaredName, languageOf, outsideImportersOf } from '@variance-authority/sense';
import { useOf } from '../refresh-native.js';
import { ownerOf } from './by-path.js';
import { unreadLine } from './declared.js';
import { places } from './members.js';
import { type Shown, kinds, nearestLine } from './sites.js';
import { symbol } from './symbol.js';
import { indexed } from './unpublished.js';
import type { Site } from './uses-of.js';

/**
 * The imports of a name from outside the workspace, the installed packages
 * and the runtime's modules they are out of, and the files whose imports were
 * not read; or why the index was not read.
 */
export type Outside =
  | {
      readonly sites: readonly Site[];
      readonly packages: readonly string[];
      /** The runtime's modules, each with its `node:` scheme. */
      readonly modules: readonly string[];
      /** The `file:line` of each site that is an `export … from`, which passes the name on. */
      readonly passing: readonly string[];
      readonly notRead: readonly string[];
    }
  | { readonly unread: string };

/**
 * Every import of `name` out of a package no manifest of the workspace
 * declares, or out of a module the runtime owns, read off the source index of
 * `root`, narrowed to `wanted` when it names a package, one of its
 * specifiers, or a module of the runtime's. An `export … from` is listed as
 * the import it is, marked as passing the name on.
 */
export function outsideOf(root: string | undefined, name: string, wanted: string | undefined): Outside {
  const answer = indexed(root, (checkout) => outsideImportersOf(checkout, name));
  if ('unread' in answer) return answer;
  const { read } = answer;
  const owner = wanted === undefined ? undefined : ownerOf(wanted);
  const taken = read.uses.filter(({ package: of, runtime, site }) => {
    if (wanted === undefined) return true;
    if (runtime) return of === wanted || of === `node:${wanted}`;
    return of === owner && (wanted === owner || site.key === wanted);
  });
  const sites = taken.map(({ package: of, runtime, passesOn, site }): Site => {
    const from = `from ${of}${runtime ? ", the runtime's" : ''}${passesOn ? ', passes it on' : ''}`;
    return { ...useOf(site), name: site.name, by: site.by === '' ? from : `${site.by}, ${from}` };
  });
  const passing = taken.filter((one) => one.passesOn).map(({ site }) => `${site.at}:${site.line}`);
  const sorted = (runtime: boolean): readonly string[] => [...new Set(taken.filter((one) => one.runtime === runtime).map((one) => one.package))].sort();
  return { sites, packages: sorted(false), modules: sorted(true), passing, notRead: read.unread };
}

/** How many files whose imports were not read `importsUnread` names before it counts the rest. */
const NOT_READ_NAMED = 3;

/**
 * The sentence that names the files the source index holds and whose imports
 * it could not read, any of which may import the name from outside the
 * workspace; nothing when every file's were read.
 */
export function importsUnread(outside: Outside): readonly string[] {
  if (!('notRead' in outside) || outside.notRead.length === 0) return [];
  const { notRead } = outside;
  const files = notRead.length === 1 ? '1 file' : `${notRead.length} files`;
  const more = notRead.length - NOT_READ_NAMED;
  const named = `${notRead.slice(0, NOT_READ_NAMED).join(', ')}${more > 0 ? ` and ${more} more` : ''}`;
  return [`The imports of ${files} were not read, so an import of it there from outside the workspace is not known: ${named}.`];
}

/** What the workspace declares under one name, as `usesOf` read it. */
export interface Carried {
  readonly name: string;
  readonly found: readonly (readonly [Documented, Opening, Entry])[];
  readonly exported: readonly Named[];
  /** The exports of each other declaration by the name. */
  readonly namesakes: readonly { readonly exported: readonly Named[] }[];
  readonly kept: readonly DeclaredName[];
  readonly members: { readonly declared: readonly Use[] };
}

/**
 * Every declaration that carries the name, one to a line, when there is more
 * than one: what each is and where, and each installed package and module of
 * the runtime's the name is imported from. Nothing when the name is one
 * declaration.
 */
export function carriers(carried: Carried, outside: Outside, shown: Shown): readonly string[] {
  const { name, found, kept } = carried;
  const [packages, modules] = 'sites' in outside ? [outside.packages, outside.modules] : [[], []];
  const published = new Map(found.map(([, , entry]) => [`${entry.at}:${entry.line}`, `${entry.kind}, published, at ${entry.at}:${entry.line}`]));
  // Each declaration's exports come declaring one first; the ones passing it on are not another declaration.
  const exports = [carried.exported, ...carried.namesakes.map((one) => one.exported)]
    .flatMap((group) => group.slice(0, 1))
    .map((one) => `${one.declaration ?? 'export'}, exported, at ${one.at}:${one.line}`);
  const declarations = [
    ...published.values(),
    ...exports,
    ...kept.map((one) => `${one.kind}, declared, not exported, at ${one.at}:${one.line}`),
    ...carried.members.declared.map((one) => `member of \`${one.by}\` at ${one.at}:${one.line}`),
  ];
  const lines = [
    ...declarations,
    ...packages.map((owner) => `imported from ${owner}, which declares it outside the workspace`),
    ...modules.map((module) => `imported from ${module}, which the runtime declares`),
  ];
  if (lines.length < 2) return [];
  const cut = lines.slice(0, shown.limit);
  return [
    `\`${name}\` ${carrying(declarations.length, packages.length, modules.length)}, each answered below:`,
    ...cut.map((line) => `  ${line}`),
    ...(lines.length > cut.length ? [`  … ${notShown(lines.length - cut.length, shown.spell)}`] : []),
    '',
  ];
}

/**
 * What carries a name, counted: the workspace's declarations of it, and the
 * installed packages and the runtime's modules it is imported from.
 */
function carrying(declared: number, packages: number, modules: number): string {
  const of = (count: number, one: string): string => `${count} ${one}${count === 1 ? '' : 's'}`;
  const from = [...(packages === 0 ? [] : [of(packages, 'installed package')]), ...(modules === 0 ? [] : [of(modules, 'built-in module')])];
  const imported = from.length === 0 ? undefined : `is imported from ${from.join(' and ')}`;
  const names = declared === 0 ? undefined : `names ${of(declared, 'declaration')}`;
  return [names, imported].filter((part) => part !== undefined).join(' and ');
}

/** What may hold a declaration of the name in the workspace and was not read. */
export interface Unread {
  /** The files whose declarations the source index does not hold. */
  readonly declarations: readonly string[];
  /** Why the members by the name were not read, when they were not. */
  readonly members: string | undefined;
}

/**
 * The imports of a name from outside the workspace: the whole answer when
 * `alone`, else after the workspace's. Either way it ends with the files whose
 * imports were not read, any of which may import the name; alone, with what
 * of the workspace was not read and may declare it too, `unread`.
 */
export function outsideLines(name: string, outside: Outside, alone: boolean, from: string | undefined, shown: Shown, unread: Unread): readonly string[] {
  if (!('sites' in outside)) return [];
  const notRead = importsUnread(outside);
  const { sites, packages, modules } = outside;
  if (sites.length === 0) return alone || notRead.length === 0 ? [] : ['', ...notRead];
  const out = [...packages, ...modules].join(', ');
  if (!alone) {
    return ['', `\`${name}\` is imported from outside the workspace too, in ${places(sites.length)}, out of ${out}:`, ...kinds(sites, from, name, shown, undefined), ...(notRead.length === 0 ? [] : ['', ...notRead])];
  }
  const nearest = nearestLine(from, shown.spell);
  const read = unread.declarations.length === 0 ? '' : ' that the source index read';
  return [
    `\`${name}\` is declared in no file of this workspace${read}; it is imported from outside it in ${places(sites.length)}, out of ${out}.`,
    nearest,
    ...kinds(sites, from, name, shown, undefined),
    '',
    ...(packages.length === 0 ? [] : [`\`${shown.spell.tool(symbol)}\` has its declaration in each package.`]),
    ...(modules.length === 0 ? [] : ["A built-in module's declaration is the runtime's, which the source index does not read."]),
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
