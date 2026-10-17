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
import { places } from './members.js';
import { type Site, kinds } from './sites.js';

/** The imports of a name out of packages the workspace installs, and those packages; or why they were not read. */
export type Outside = { readonly sites: readonly Site[]; readonly packages: readonly string[] } | { readonly unread: string };

/**
 * Every import of `name` out of a package no manifest of the workspace
 * declares, read off the source index of `root`, narrowed to `wanted` when it
 * names a package or one of its specifiers.
 */
export function outsideOf(root: string | undefined, name: string, wanted: string | undefined): Outside {
  if (root === undefined) return { unread: 'this host named no checkout to read the source index of' };
  let read: ReturnType<typeof thirdPartyImportersOf>;
  try {
    read = thirdPartyImportersOf(root, name);
  } catch (error) {
    return { unread: `${error instanceof Error ? error.message : String(error)}; run \`variance index\`` };
  }
  if (read === undefined) return { unread: 'no source index is published; run `variance index`' };
  const owner = wanted === undefined ? undefined : ownerOf(wanted);
  const taken = read.filter((use) => owner === undefined || (ownerOf(use.key) === owner && (wanted === owner || use.key === wanted)));
  const sites = taken.map((use): Site => {
    const from = `from ${ownerOf(use.key)}`;
    return { ...useOf(use), name: use.name, by: use.by === '' ? from : `${use.by}, ${from}` };
  });
  return { sites, packages: [...new Set(taken.map((use) => ownerOf(use.key)))].sort() };
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
export function carriers(carried: Carried, outside: readonly string[], limit: number): readonly string[] {
  const { name, found, exported, kept, members } = carried;
  const published = new Map(found.map(([, , entry]) => [`${entry.at}:${entry.line}`, `${entry.kind}, published, at ${entry.at}:${entry.line}`]));
  // An `export … from` passes on a declaration of another file, which is not another one.
  const declaring = exported.filter((one) => one.declaration !== undefined);
  const exports = (declaring.length > 0 ? declaring : exported).map((one) => `${one.declaration ?? 'export'}, exported, at ${one.at}:${one.line}`);
  const lines = [
    ...published.values(),
    ...exports,
    ...kept.map((one) => `${one.kind}, declared, not exported, at ${one.at}:${one.line}`),
    ...members.map((one) => `member of \`${one.by}\` at ${one.at}:${one.line}`),
    ...outside.map((owner) => `imported from ${owner}, which declares it outside the workspace`),
  ];
  if (lines.length < 2) return [];
  const shown = lines.slice(0, limit);
  return [
    `\`${name}\` names ${lines.length} declarations, each answered below:`,
    ...shown.map((line) => `  ${line}`),
    ...(lines.length > shown.length ? [`  … ${notShown(lines.length - shown.length)}`] : []),
    '',
  ];
}

/** The imports of a name out of packages the workspace installs: the whole answer when `alone`, else after the workspace's. */
export function outsideLines(name: string, outside: Outside, alone: boolean, from: string | undefined, limit: number): readonly string[] {
  if (!('sites' in outside) || outside.sites.length === 0) return [];
  const { sites, packages } = outside;
  const out = packages.join(', ');
  if (!alone) return ['', `\`${name}\` is imported from outside the workspace too, in ${places(sites.length)}, out of ${out}:`, ...kinds(sites, from, name, limit)];
  const nearest = from === undefined ? 'Path order; `from` sorts nearest first.' : `Nearest to ${from} first.`;
  return [
    `\`${name}\` is declared in no file of this workspace; it is imported from outside it in ${places(sites.length)}, out of ${out}.`,
    nearest,
    ...kinds(sites, from, name, limit),
    '',
    'docs_symbol has its declaration in each package.',
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
