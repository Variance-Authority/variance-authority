import type { LexiconField, RunReport, SubjectLexicon } from '@variance-authority/report';

/**
 * The lexicon as an inverted index: every token the run's names split into,
 * pointing at the values that hold it.
 *
 * `variance_locate` is a lookup over names the run wrote down, and the names do
 * not change between two questions asked of one report. So the tokenising is
 * done once per report, here, and a question costs what its own words touch: a
 * lookup per token, a walk over the prefix run for a stem, an intersection per
 * term. The scan this replaces re-split every value of every subject for every
 * word of every question, which on three hundred subjects was a tenth of a
 * second per question and on three thousand would be a second.
 *
 * Nothing about the rank lives here. An entry is a fact, *this value holds this
 * token*; the order of the answer is `locate.ts`'s, and it reads the same facts
 * it read off the scan, so the two agree to the byte.
 */

/** A field a hit can match in: the lexicon's, plus the subject id itself. */
export type LocateField = LexiconField | 'id';

export const ALL_FIELDS: readonly LexiconField[] = [
  'example',
  'names',
  'text',
  'components',
  'createdBy',
  'regions',
  'files',
  'roles',
  'tokens',
];

/** One value of one field of one subject — the thing a token points at. */
export interface LocateEntry {
  readonly subject: string;
  readonly field: LocateField;
  readonly value: string;
}

export interface LocateIndex {
  /** Every subject the report names, by id; one the run wrote no lexicon for holds no terms. */
  readonly subjects: ReadonlyMap<string, SubjectLexicon>;
  /** Subjects indexed by id alone. */
  readonly idOnly: number;
  /** Fields the run read; `id` is always among them. */
  readonly read: readonly LocateField[];
  /** Fields the run did not read. */
  readonly unread: readonly LexiconField[];
  /** Subject → components it is the narrow example of, from the composition. */
  readonly examples: ReadonlyMap<string, readonly string[]>;
  /** The suite's accessible names, code-unit order. */
  readonly names: readonly string[];
  /**
   * Entries in subject order, then `id` and the lexicon's fields in `ALL_FIELDS`
   * order, then the field's own order — so ascending entry ids read as the scan
   * would have.
   */
  readonly entries: readonly LocateEntry[];
  /** Every token, distinct, code-unit order; a prefix is a run of this list. */
  readonly tokens: readonly string[];
  /** Token → entry ids holding it, ascending. */
  readonly postings: ReadonlyMap<string, readonly number[]>;
}

const built = new WeakMap<RunReport, LocateIndex>();

/** The index of a report, built on the first question and kept with the report. */
export function indexOf(report: RunReport): LocateIndex {
  let index = built.get(report);
  if (index === undefined) built.set(report, (index = build(report)));
  return index;
}

function build(report: RunReport): LocateIndex {
  const lexicon = report.lexicon;
  const subjects = new Map<string, SubjectLexicon>();
  for (const entry of lexicon?.subjects ?? []) subjects.set(entry.subject, entry);
  let idOnly = 0;
  for (const subject of [
    ...report.observations.map((entry) => entry.subject),
    ...(report.notObserved ?? []).map((entry) => entry.subject),
  ]) {
    if (subjects.has(subject)) continue;
    subjects.set(subject, { subject, boundaries: 0, terms: {} });
    idOnly += 1;
  }

  const read: LocateField[] = ['id', ...(lexicon?.fields ?? [])];
  const unread = ALL_FIELDS.filter((field) => !read.includes(field));

  const examples = new Map<string, string[]>();
  for (const entry of report.composition?.components ?? []) {
    for (const subject of entry.examples) {
      let list = examples.get(subject);
      if (list === undefined) examples.set(subject, (list = []));
      list.push(entry.component);
    }
  }

  const names = new Set<string>();
  const entries: LocateEntry[] = [];
  const postings = new Map<string, number[]>();
  for (const [subject, entry] of subjects) {
    for (const name of entry.terms.names ?? []) names.add(name);
    const fields: readonly (readonly [LocateField, readonly string[]])[] = [
      ['id', [subject]],
      ...ALL_FIELDS.map((field) => [field, entry.terms[field] ?? []] as const),
    ];
    for (const [field, values] of fields) {
      for (const value of values) {
        const id = entries.push({ subject, field, value }) - 1;
        for (const token of tokensOf(value)) {
          let list = postings.get(token);
          if (list === undefined) postings.set(token, (list = []));
          list.push(id);
        }
      }
    }
  }

  return {
    subjects,
    idOnly,
    read,
    unread,
    examples,
    names: [...names].sort(codeUnit),
    entries,
    tokens: [...postings.keys()].sort(codeUnit),
    postings,
  };
}

/**
 * Entry ids whose value every part of a term matches, ascending.
 *
 * A part matches a value when it is a token of the value, or a prefix of one at
 * three characters or more. Parts, not the whole: `TodoFooter` typed whole must
 * find `TodoFooter` the component and not `todo.tsx` the file, so the term is
 * split the way names are and all of its pieces have to land. A one-word term is
 * the ordinary case and the rule collapses to *is this word in the name*.
 */
export function entriesMatching(index: LocateIndex, parts: readonly string[]): readonly number[] {
  let held: readonly number[] | undefined;
  for (const part of parts) {
    const ids = entriesHolding(index, part);
    held = held === undefined ? ids : intersect(held, ids);
    if (held.length === 0) return held;
  }
  return held ?? [];
}

function entriesHolding(index: LocateIndex, part: string): readonly number[] {
  const lists: (readonly number[])[] = [];
  const exact = index.postings.get(part);
  if (exact !== undefined) lists.push(exact);
  if (part.length >= 3) {
    for (let at = lowerBound(index.tokens, part); at < index.tokens.length; at += 1) {
      const token = index.tokens[at]!;
      if (!token.startsWith(part)) break;
      if (token !== part) lists.push(index.postings.get(token)!);
    }
  }
  if (lists.length === 1) return lists[0]!;
  const union = new Set<number>();
  for (const list of lists) for (const id of list) union.add(id);
  return [...union].sort((left, right) => left - right);
}

/** First position whose token is not below `part` in code-unit order. */
function lowerBound(tokens: readonly string[], part: string): number {
  let low = 0;
  let high = tokens.length;
  while (low < high) {
    const mid = (low + high) >>> 1;
    if (tokens[mid]! < part) low = mid + 1;
    else high = mid;
  }
  return low;
}

function intersect(left: readonly number[], right: readonly number[]): readonly number[] {
  const out: number[] = [];
  let l = 0;
  let r = 0;
  while (l < left.length && r < right.length) {
    if (left[l]! === right[r]!) {
      out.push(left[l]!);
      l += 1;
      r += 1;
    } else if (left[l]! < right[r]!) l += 1;
    else r += 1;
  }
  return out;
}

/** The parts of a query term: its tokens, without the unsplit compound. */
export function partsOf(term: string): readonly string[] {
  const tokens = tokensOf(term);
  return tokens.length > 1 ? tokens.filter((token) => token !== stem(lower(term))) : tokens;
}

/**
 * One tokeniser for both sides. Separators and camel-case boundaries split;
 * the unsplit compound is kept, so a name typed whole still matches exactly;
 * ASCII lowercase only, because the dotless-i is a promise about `LANG`; a
 * trailing `s` is dropped from words of four letters or more so `counts` meets
 * `count`. Digests are dropped whole — a match on a coordinate is not a match.
 */
export function tokensOf(value: string): readonly string[] {
  if (/^v\d+:[0-9a-f]+$/.test(value)) return [];
  const out = new Set<string>();
  for (const piece of value.split(/[\s/\-_.#:@,()[\]"'`]+/)) {
    if (piece === '') continue;
    const whole = stem(lower(piece));
    if (whole !== '') out.add(whole);
    const camel = piece
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
      .split(' ');
    if (camel.length > 1) for (const part of camel) out.add(stem(lower(part)));
  }
  out.delete('');
  return [...out];
}

function stem(word: string): string {
  return word.length >= 4 && word.endsWith('s') && !word.endsWith('ss') ? word.slice(0, -1) : word;
}

export function lower(value: string): string {
  return value.replace(/[A-Z]/g, (letter) => String.fromCharCode(letter.charCodeAt(0) + 32));
}

/** Code-unit order: the same bytes on every machine, whatever `LANG` says. */
export function codeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
