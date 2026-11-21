/**
 * Which words of a sentence are names this workspace publishes, and how they
 * are said.
 *
 * Apart from the tool for the reason `code-map-format.ts` is: matching and
 * wording are pure functions of the reading and the placements, and a test
 * holding them should not need a repository and an index to get one.
 *
 * A word is an entity when it is, whole, the name of a package the code map
 * holds or that name without its scope, an entrypoint's specifier with or
 * without the scope (both matched without case), or a published exported name,
 * matched as it is spelled. The packages are the map's, so one that publishes
 * nothing is still named; the entrypoints and exports are the reading's. A word
 * that is only part of a name is not one: `check` beside `checkoutPath` names
 * nothing. There is no ranking and no model; the dictionary is the reading.
 */

// compass: variance-authority.report.agent-surface

import { everyEntry, type Help } from '@variance-authority/package/help';
import { STALE_MAP, unscoped } from './code-map-format.js';
import { specifierOf } from './find.js';
import type { RankedArea } from './classify-areas.js';
import { narrower, plural, shell } from './format.js';

/** What one word names: a package, one of its entrypoints, or a name it exports. */
export interface Named {
  readonly kind: 'package' | 'entrypoint' | 'export';
  /** The package, the entrypoint, or the specifier the name is imported from. */
  readonly specifier: string;
  readonly package: string;
  /** Whether the reading publishes it; a package the map holds may publish nothing. */
  readonly published: boolean;
}

/** A word that names something, with everything it names: packages first, then entrypoints, then exports. */
export interface Entity {
  readonly word: string;
  readonly names: readonly Named[];
}

export interface Classified {
  /** In the order the asker first wrote each one, each naming only what no earlier word named. */
  readonly entities: readonly Entity[];
  /** The words that name nothing, in the asker's order, each once. */
  readonly plain: readonly string[];
}

/** Where a package sits on the code map: its innermost area, absent for one no area took, and its dependency layer. */
export interface Placed {
  readonly area?: { readonly id: string; readonly name: string };
  readonly layer: number;
  /** Its directory from the workspace, as the map's scan drew it; empty for the root. */
  readonly directory: string;
}

/** Every package on the code map, placed, and whether the map was folded from the source index as it stands. */
export interface CodeMapPlaces {
  readonly current: boolean;
  readonly packages: ReadonlyMap<string, Placed>;
}

const ORDER: readonly Named['kind'][] = ['package', 'entrypoint', 'export'];

/**
 * The asker's words: a scoped name, a path and an identifier stay whole, and
 * the punctuation a sentence puts around them is dropped.
 */
function wordsOf(text: string): readonly string[] {
  return (text.match(/@?[\p{L}\p{N}_$][\p{L}\p{N}_$@./-]*/gu) ?? []).map((word) => word.replace(/[./-]+$/u, ''));
}

/** Every spelling of the mapped packages and of what the reading publishes, keyed by how a word is compared with it. */
function dictionaryOf(help: Help, packages: Iterable<string>): { readonly folded: ReadonlyMap<string, Named[]>; readonly exact: ReadonlyMap<string, Named[]> } {
  const folded = new Map<string, Named[]>();
  const exact = new Map<string, Named[]>();
  const add = (into: Map<string, Named[]>, key: string, named: Named): void => {
    const held = into.get(key) ?? [];
    if (!held.some((one) => one.kind === named.kind && one.specifier === named.specifier)) held.push(named);
    into.set(key, held);
  };
  const publishing = new Set(help.packages.map((published) => published.name));
  for (const owner of packages) {
    const named: Named = { kind: 'package', specifier: owner, package: owner, published: publishing.has(owner) };
    for (const spelled of new Set([owner, unscoped(owner)])) add(folded, spelled.toLowerCase(), named);
  }
  for (const published of help.packages) {
    for (const opening of published.openings) {
      if (opening.subpath === '.') continue;
      const specifier = specifierOf(published, opening);
      for (const spelled of new Set([specifier, unscoped(specifier)])) {
        add(folded, spelled.toLowerCase(), { kind: 'entrypoint', specifier, package: published.name, published: true });
      }
    }
  }
  for (const [published, opening, entry] of everyEntry(help)) {
    add(exact, entry.name, { kind: 'export', specifier: specifierOf(published, opening), package: published.name, published: true });
  }
  return { folded, exact };
}

/** The words of `text` that are, whole, one of `packages` or a name `help` publishes, and the words that are not. */
export function classifyWords(text: string, help: Help, packages: Iterable<string>): Classified {
  const { folded, exact } = dictionaryOf(help, packages);
  const entities: Entity[] = [];
  const plain = new Set<string>();
  const listed = new Set<string>();
  for (const word of wordsOf(text)) {
    // A package or an entrypoint is matched without case and an export only as
    // spelled, so a word lists only what no earlier word did: `Sense` after
    // `sense` still names an export `Sense`, and names nothing new otherwise.
    // An export is its name in its specifier, so two names one entrypoint
    // exports are two entities.
    const names = [...(folded.get(word.toLowerCase()) ?? []), ...(exact.get(word) ?? [])];
    if (names.length === 0) {
      plain.add(word);
      continue;
    }
    const keyOf = (named: Named): string => (named.kind === 'export' ? `export ${named.specifier} ${word}` : `${named.kind} ${named.specifier}`);
    const fresh = names.filter((named) => !listed.has(keyOf(named)));
    for (const named of fresh) listed.add(keyOf(named));
    if (fresh.length > 0) entities.push({ word, names: fresh.sort((one, other) => ORDER.indexOf(one.kind) - ORDER.indexOf(other.kind)) });
  }
  return { entities, plain: [...plain] };
}

function where(placed: Placed | undefined): string {
  // A package published since the map was folded; the stale sentence says why.
  if (placed === undefined) return ' · not on the code map';
  const area = placed.area === undefined ? ' · in no area' : ` · area ${placed.area.id} ${placed.area.name}`;
  return `${area} · layer ${placed.layer}`;
}

/** An area of the tree, with the package it sits in when a manifest at or above it names one. */
export type PlacedArea = RankedArea & { readonly package?: string };

/**
 * Each area in the map package whose directory is nearest at or above it,
 * under the name the map gives that package; an area above every package on
 * the map is in none.
 */
export function placedAreas(areas: readonly RankedArea[], packages: ReadonlyMap<string, Placed>): readonly PlacedArea[] {
  const owners = [...packages].map(([name, { directory }]) => ({ name, directory: directory === '.' ? '' : directory }));
  return areas.map((area) => {
    const path = area.path === '.' ? '' : area.path;
    let owner: { readonly name: string; readonly directory: string } | undefined;
    for (const held of owners) {
      const above = held.directory === '' || path === held.directory || path.startsWith(`${held.directory}/`);
      if (above && (owner === undefined || held.directory.length > owner.directory.length)) owner = held;
    }
    return owner === undefined ? area : { ...area, package: owner.name };
  });
}

/** The start point the asker said, by the flag that said it. */
export type StartPoint = { readonly from?: readonly string[]; readonly to?: readonly string[] };

/**
 * The entities, one line per thing each names with its place on the code map,
 * then the plain words on one line, then the areas of the tree the words point
 * to, best first, each with its package and that package's place on the map.
 */
export function formatClassified(
  { entities, plain }: Classified,
  { current, packages }: CodeMapPlaces,
  areas: readonly PlacedArea[] = [],
  said: StartPoint = {},
): string {
  const lines = [
    entities.length === 0
      ? 'No word names a package on the code map, an entrypoint or an exported name.'
      : `${plural(entities.length, 'word names', 'words name')} a package on the code map, an entrypoint or an exported name:`,
    ...entities.flatMap(({ word, names }) =>
      names.map((named, at) => `${at === 0 ? word : ' '.repeat(word.length)} — ${named.kind} ${named.specifier}${where(packages.get(named.package))}`),
    ),
  ];
  if (plain.length > 0) lines.push(`Not entities: ${plain.join(' ')}`);
  if (areas.length > 0) {
    lines.push('', 'Areas its words point to, best first:');
    for (const area of areas) {
      const placed = area.package === undefined ? '' : ` · in ${area.package}${where(packages.get(area.package))}`;
      lines.push(`  ${area.path} — ${plural(area.files, 'file')} · holds ${area.words.join(' ')}${placed}`);
    }
  }
  // What each entity is asked next: an exported name is read by `symbol`, a
  // published package or entrypoint counted by `entrypoint`, and a package that
  // publishes nothing placed by `orient` on its area, if one took it.
  const asks = entities.flatMap(({ word, names }) => names.flatMap((named) => {
    if (named.kind === 'export') return [`variance ask symbol --name ${shell(word)}`];
    if (named.published) return [`variance ask entrypoint --package ${shell(named.specifier)}`];
    const area = packages.get(named.package)?.area;
    return area === undefined ? [] : [`variance ask orient --area ${shell(area.id)}`];
  }));
  // `search` takes the words of one name, so the best area is asked for the
  // two that weigh most there; the root is no start point, so it is asked from
  // the start point the asker said, or whole when none was.
  const best = areas[0];
  if (best !== undefined) {
    const flags = Object.entries(said).flatMap(([which, paths]) => (paths ?? []).map((path) => ` --${which} ${shell(path)}`));
    const from = best.path === '.' ? flags.join('') : ` --from ${shell(best.path)}`;
    asks.push(`variance ask search --query ${shell(best.words.slice(0, 2).join(' '))}${from}`);
  }
  lines.push(...narrower([...new Set(asks)]));
  if (!current) lines.push('', STALE_MAP);
  return lines.join('\n');
}
