/**
 * Which words of a sentence are names this workspace publishes, and how they
 * are said.
 *
 * Apart from the tool for the reason `code-map-format.ts` is: matching and
 * wording are pure functions of the reading and the placements, and a test
 * holding them should not need a repository and an index to get one.
 *
 * A word is an entity when it is, whole, a package's name or that name without
 * its scope, an entrypoint's specifier with or without the scope (both matched
 * without case), or a published exported name, matched as it is spelled. A word
 * that is only part of a name is not one: `check` beside `checkoutPath` names
 * nothing. There is no ranking and no model; the dictionary is the reading.
 */

// compass: variance-authority.report.agent-surface

import type { Help } from '@variance-authority/package/help';
import { unscoped } from './code-map-format.js';
import { specifierOf } from './find.js';
import { narrower, plural, shell } from './format.js';

/** What one word names: a package, one of its entrypoints, or a name it exports. */
export interface Named {
  readonly kind: 'package' | 'entrypoint' | 'export';
  /** The package, the entrypoint, or the specifier the name is imported from. */
  readonly specifier: string;
  readonly package: string;
}

/** A word that names something, with everything it names: packages first, then entrypoints, then exports. */
export interface Entity {
  readonly word: string;
  readonly names: readonly Named[];
}

export interface Classified {
  /** In the order the asker first wrote each one. */
  readonly entities: readonly Entity[];
  /** The words that name nothing, in the asker's order, each once. */
  readonly plain: readonly string[];
}

/** Where a package sits on the code map: its innermost area, absent for one no area took, and its dependency layer. */
export interface Placed {
  readonly area?: { readonly id: string; readonly name: string };
  readonly layer?: number;
}

export type Placements = ReadonlyMap<string, Placed>;

const ORDER: readonly Named['kind'][] = ['package', 'entrypoint', 'export'];

/**
 * The asker's words: a scoped name, a path and an identifier stay whole, and
 * the punctuation a sentence puts around them is dropped.
 */
function wordsOf(text: string): readonly string[] {
  return (text.match(/@?[\p{L}\p{N}_$][\p{L}\p{N}_$@./-]*/gu) ?? []).map((word) => word.replace(/[./-]+$/u, ''));
}

/** Every spelling the reading publishes, keyed by how a word is compared with it. */
function dictionaryOf(help: Help): { readonly folded: ReadonlyMap<string, Named[]>; readonly exact: ReadonlyMap<string, Named[]> } {
  const folded = new Map<string, Named[]>();
  const exact = new Map<string, Named[]>();
  const add = (into: Map<string, Named[]>, key: string, named: Named): void => {
    const held = into.get(key) ?? [];
    if (!held.some((one) => one.kind === named.kind && one.specifier === named.specifier)) held.push(named);
    into.set(key, held);
  };
  for (const published of help.packages) {
    const owner = published.name;
    for (const spelled of new Set([owner, unscoped(owner)])) add(folded, spelled.toLowerCase(), { kind: 'package', specifier: owner, package: owner });
    for (const opening of published.openings) {
      const specifier = specifierOf(published, opening);
      if (opening.subpath !== '.') {
        for (const spelled of new Set([specifier, unscoped(specifier)])) {
          add(folded, spelled.toLowerCase(), { kind: 'entrypoint', specifier, package: owner });
        }
      }
      for (const entry of opening.entries) add(exact, entry.name, { kind: 'export', specifier, package: owner });
    }
  }
  return { folded, exact };
}

/** The words of `text` that are, whole, a name `help` publishes, and the words that are not. */
export function classifyWords(text: string, help: Help): Classified {
  const { folded, exact } = dictionaryOf(help);
  const entities = new Map<string, Entity>();
  const plain = new Set<string>();
  for (const word of wordsOf(text)) {
    // A package or an entrypoint is matched without case, so its word is
    // listed once however it is written; an export only as spelled.
    const caseless = folded.get(word.toLowerCase());
    const key = caseless === undefined ? word : word.toLowerCase();
    if (entities.has(key) || plain.has(word)) continue;
    const names = [...(caseless ?? []), ...(exact.get(word) ?? [])]
      .sort((one, other) => ORDER.indexOf(one.kind) - ORDER.indexOf(other.kind));
    if (names.length === 0) plain.add(word);
    else entities.set(key, { word, names });
  }
  return { entities: [...entities.values()], plain: [...plain] };
}

function where(placed: Placed | undefined): string {
  if (placed === undefined) return ' · not on the code map';
  const area = placed.area === undefined ? ' · in no area' : ` · area ${placed.area.id} ${placed.area.name}`;
  return `${area}${placed.layer === undefined ? '' : ` · layer ${placed.layer}`}`;
}

/** The entities, one line per thing each names with its place on the code map, then the plain words on one line. */
export function formatClassified({ entities, plain }: Classified, placements: Placements): string {
  const lines = [
    entities.length === 0
      ? 'No word names a package, an entrypoint or an exported name this workspace publishes.'
      : `${plural(entities.length, 'word names', 'words name')} what this workspace publishes:`,
    ...entities.flatMap(({ word, names }) =>
      names.map((named, at) => `${at === 0 ? word : ' '.repeat(word.length)} — ${named.kind} ${named.specifier}${where(placements.get(named.package))}`),
    ),
  ];
  if (plain.length > 0) lines.push(`Not entities: ${plain.join(' ')}`);
  // What each entity is asked next: a package or an entrypoint is counted by
  // `entrypoint`, an exported name is read by `symbol`.
  const asks = entities.flatMap(({ word, names: [first] }) => {
    if (first === undefined) return [];
    return [first.kind === 'export' ? `variance ask symbol --name ${shell(word)}` : `variance ask entrypoint --package ${shell(first.specifier)}`];
  });
  lines.push(...narrower([...new Set(asks)]));
  return lines.join('\n');
}
