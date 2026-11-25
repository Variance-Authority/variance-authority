/**
 * What each case heard, read off the sections `case_said.rs` laid. It is plain
 * JavaScript, so the page `variance view` writes reads a record with it.
 *
 * A section is little-endian words: the id of the set of cases listened to, how
 * many texts there are, where each begins and the last ends, the texts, how
 * many items there are, then a column each of every item's name, value, site,
 * level and set of cases. A section that is not exactly that is refused.
 */
import { invalid } from './case-lines.js';
import type { Said } from './case-said.js';
import { openCrossingSets } from './crossing-sets-read.js';
import type { CrossingSetsPool } from './crossing-sets.js';

/** A value that could not be recorded, as a section spells it. */
const UNRECORDED = 0xffff_ffff;

const FACETS = ['said', 'read', 'misused'] as const;

type Facet = (typeof FACETS)[number];

type Item = readonly [name: string, value: string | null, site: string, level: number];

/**
 * What each case heard, off the `tests.said`, `tests.read` and `tests.misused`
 * sections, any absent, and their pool; undefined for a case never listened to.
 */
export function saidRead(
  sections: { readonly [facet in Facet]?: Uint8Array },
  pool: Pick<CrossingSetsPool, 'bytes' | 'offsets'>,
  testCount: number,
): readonly (Said | undefined)[] {
  const sets = openCrossingSets({ ...pool, testCount });
  const members = (set: number) => {
    if (set >= sets.size) throw invalid();
    return sets.members(set);
  };
  const facets = FACETS.map((facet) => {
    const section = sections[facet];
    return [facet, section === undefined ? undefined : itemsOf(section, testCount, members)] as const;
  });
  return Array.from({ length: testCount }, (_, test) => {
    const heard: Partial<Record<Facet, readonly Item[]>> = {};
    for (const [facet, items] of facets) {
      const held = items?.[test];
      if (held !== undefined) heard[facet] = held;
    }
    return Object.keys(heard).length === 0 ? undefined : JSON.stringify(heard);
  });
}

/** One section's items, case by case; undefined for a case it was not listened to in. */
function itemsOf(section: Uint8Array, testCount: number, members: (set: number) => Iterable<number>): readonly (Item[] | undefined)[] {
  const view = new DataView(section.buffer, section.byteOffset, section.byteLength);
  let at = 0;
  const word = () => {
    if (at + 4 > section.length) throw invalid();
    at += 4;
    return view.getUint32(at - 4, true);
  };
  const words = (count: number) => {
    if (count * 4 > section.length - at) throw invalid();
    return Array.from({ length: count }, word);
  };
  const listened = word();
  const bounds = words(word() + 1);
  const blob = section.subarray(at, at + bounds[bounds.length - 1]!);
  if (blob.length !== bounds[bounds.length - 1]) throw invalid();
  at += blob.length;
  const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const texts = bounds.slice(1).map((end, text) => {
    if (end < bounds[text]!) throw invalid();
    try {
      return utf8.decode(blob.subarray(bounds[text], end));
    } catch {
      throw invalid();
    }
  });
  const items = word();
  const [names, values, sites, levels, held] = [words(items), words(items), words(items), words(items), words(items)];
  if (at !== section.length) throw invalid();
  const text = (id: number) => {
    const found = texts[id];
    if (found === undefined) throw invalid();
    return found;
  };
  const cases = Array.from<Item[] | undefined>({ length: testCount });
  for (const test of members(listened)) {
    if (test >= testCount) throw invalid();
    cases[test] = [];
  }
  for (let item = 0; item < items; item += 1) {
    const value = values[item]!;
    const row: Item = [text(names[item]!), value === UNRECORDED ? null : text(value), text(sites[item]!), levels[item]!];
    for (const test of members(held[item]!)) {
      const rows = cases[test];
      if (rows === undefined) throw invalid();
      rows.push(row);
    }
  }
  return cases;
}
