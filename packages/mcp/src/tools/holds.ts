import type { Landmark, RunReport, SubjectLexicon } from '@variance-authority/report';
import { tokensOf } from './locate-index.js';

/**
 * Which surfaces could hold both, before any of them is read.
 *
 * Step one of the three the answer is built from, and the one that has to
 * survive twenty thousand stories. A few words of memory per subject, tested
 * for the anchor's words and the target's together, allowed to say *maybe* and
 * never *no* when the answer is yes — so what it returns is a superset and
 * nothing correct is discarded here.
 */
/**
 * Words a subject's landmarks say, as a filter that may say *maybe*.
 *
 * Two hundred and fifty-six bits and three probes per word. Sized for the
 * corpus it is meant for rather than the one it is tested on: a story holding
 * a hundred distinct landmark words sits near a one-in-fifty false-positive
 * rate, which costs a survivor an exact walk it did not need and costs a
 * correct answer nothing at all. That asymmetry is the whole reason a filter is
 * allowed here — it may waste work, it may never lose an answer.
 */
export class Holds {
  private readonly bits = new Uint32Array(8);

  add(word: string): void {
    for (const bit of probes(word)) this.bits[bit >>> 5]! |= 1 << (bit & 31);
  }

  /** `false` means certainly absent. `true` means present or a collision. */
  maybe(word: string): boolean {
    for (const bit of probes(word)) {
      if ((this.bits[bit >>> 5]! & (1 << (bit & 31))) === 0) return false;
    }
    return true;
  }
}

function probes(word: string): readonly number[] {
  // FNV-1a, then two cheap re-mixes of it. Three independent-enough positions
  // in 256 bits, with no dependency and no floating point anywhere.
  let hash = 0x811c9dc5;
  for (let at = 0; at < word.length; at += 1) {
    hash ^= word.charCodeAt(at);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  const second = Math.imul(hash ^ (hash >>> 15), 0x85ebca6b) >>> 0;
  const third = Math.imul(second ^ (second >>> 13), 0xc2b2ae35) >>> 0;
  return [hash & 255, second & 255, third & 255];
}

/** The per-subject filters, built once per report. */
export interface OrientIndex {
  readonly rows: readonly SubjectLexicon[];
  readonly holds: readonly Holds[];
  /** How many subjects say each word, for rarity. */
  readonly holders: ReadonlyMap<string, number>;
  /** `true` when every subject carrying landmarks resolved layout. */
  readonly laidOut: boolean;
  readonly surfaces: number;
}

const INDEXES = new WeakMap<RunReport, OrientIndex>();

export function orientIndexOf(report: RunReport): OrientIndex {
  const held = INDEXES.get(report);
  if (held !== undefined) return held;

  const rows = (report.lexicon?.subjects ?? []).filter(
    (row): row is SubjectLexicon => (row.landmarks?.length ?? 0) > 0,
  );
  const holds: Holds[] = [];
  const holders = new Map<string, number>();
  let laidOut = rows.length > 0;

  for (const row of rows) {
    const filter = new Holds();
    const seen = new Set<string>();
    let boxed = false;
    for (const landmark of row.landmarks ?? []) {
      if (landmark.box !== undefined) boxed = true;
      for (const word of wordsOf(landmark)) seen.add(word);
    }
    for (const word of seen) {
      filter.add(word);
      holders.set(word, (holders.get(word) ?? 0) + 1);
    }
    if (!boxed) laidOut = false;
    holds.push(filter);
  }

  const index: OrientIndex = { rows, holds, holders, laidOut, surfaces: rows.length };
  INDEXES.set(report, index);
  return index;
}

/**
 * How many of these surfaces say each word.
 *
 * The suite-wide count lives on the index and is right for a suite-wide
 * question. Scoped, it is not merely imprecise but inverted: a word two of two
 * surfaces say is worth nothing, and if those two are the whole scope the
 * scope's own subject matter scores zero against a population of one, which
 * takes every candidate out. A population and its counts have to come from the
 * same set of rows or the arithmetic is about neither.
 */
export function holdersAmong(rows: readonly SubjectLexicon[]): ReadonlyMap<string, number> {
  const holders = new Map<string, number>();
  for (const row of rows) {
    const seen = new Set<string>();
    for (const landmark of row.landmarks ?? []) {
      for (const word of wordsOf(landmark)) seen.add(word);
    }
    for (const word of seen) holders.set(word, (holders.get(word) ?? 0) + 1);
  }
  return holders;
}

/** Every word one landmark says, under the tokeniser both sides use. */
function wordsOf(landmark: Landmark): readonly string[] {
  const out = new Set<string>();
  for (const value of [landmark.name, landmark.text, landmark.role, landmark.handle, landmark.createdBy]) {
    if (value === undefined) continue;
    for (const token of tokensOf(value)) out.add(token);
  }
  return [...out];
}
