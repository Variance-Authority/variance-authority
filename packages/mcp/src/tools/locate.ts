import type { LexiconField, RunReport } from '@variance-authority/report';
import { stringArg, type Tool } from './tool.js';
import { codeUnit, entriesMatching, indexOf, lower, partsOf, type LocateField } from './locate-index.js';
import { orient } from './orient.js';
import { readQuestion } from './question.js';
import { placesOn, renderOrientation } from './place.js';
import { scopeLine, scopeOf, type Scope } from './scope.js';

export { tokensOf, type LocateField } from './locate-index.js';

/**
 * `variance_locate` — the subject you can only describe.
 *
 * Every other tool that narrows to a subject takes its id, and `variance_summary`
 * prints the ids, so on a suite of fifteen an agent finds `page/footer--counts`
 * by reading. On three hundred it cannot, and what it holds instead is a
 * description: *the footer with the filter chips*, *the toggle that marks a todo
 * done*. This turns that description into ids, over the names the run wrote
 * down for every subject.
 *
 * ## What it is not
 *
 * Not a search engine. The corpus is a few hundred short names per subject and
 * the ranking is two integers and a string: how many of the query's words a
 * subject matched, how rare each matched word is in the field it matched in
 * across the suite weighted by that field, then the smaller subject first and
 * the id in code-unit order. No term frequency, because three chips in one
 * footer is a fact about a list and not a better match; no length
 * normalisation, because the size of a subject is already the third key; no
 * floats anywhere, because two machines summing logarithms in different orders
 * can disagree at the last bit and reorder two hits.
 *
 * Rarity is counted per field and not per word, because the fields hold
 * different populations. Every subject enters `createCard` while the module
 * that declares the cards evaluates, so as a region the word is worth nothing;
 * counted once across all fields it would be worth nothing in the two ids that
 * say `card` either, and the one subject named for the card would lose to a
 * sibling that matched some other word.
 *
 * Not semantic, either, and the reason it does not need to be is the one the
 * whole system rests on: the run recorded five names for each thing. A `Toggle`
 * is also an `input`, role `checkbox`, named *Mark … as done*, in
 * `components.tsx`. A query for `checkbox` finds it with no thesaurus because
 * the page said so itself. What a word means is the caller's business; what this
 * owes the caller is every field a hit matched, so a rank can be checked against
 * the fact under it, and the suite's own vocabulary when a word matched nothing.
 *
 * ## What a question costs
 *
 * The names are split into tokens once per report and kept as an inverted index
 * (`locate-index.ts`); a question pays for the tokens it names and nothing
 * else. The run may take its time writing the lexicon down. A reader that
 * re-tokenised the suite for every question would be spending the run's
 * work again on every call, which is the one cost this tool refuses.
 *
 * ## Order is orientation, never evidence
 *
 * A wrong top hit here costs one more call. The same wrong hit quoted as a
 * finding would cost a baseline, which is why nothing printed here carries a
 * verdict or a pixel count — only ids, the places behind them, and the tools
 * that take them.
 *
 * ## The answer ends at a file
 *
 * An id is where the other tools start and not where a person's question ends.
 * *Where does the assignee warning live* is answered by a file and a line, and
 * the run wrote one down for every landmark it walked, so each hit carries the
 * landmark on that surface saying the query's words and where it is declared.
 * The place is an orientation and not a finding, the same as the order above
 * it: it says where to start reading.
 */
export const locate: Tool = {
  name: 'variance_locate',
  description:
    'Which subjects a description names. Matches the words of `query` against every name ' +
    'the run recorded per subject — its id, the component it is the example of, accessible ' +
    'names and visible text, the components it holds and who mounted them, the code regions ' +
    'its journey entered, files, roles and design tokens — and ranks by how many words matched ' +
    'and how rare each is, printing the field and value behind every hit so the order can be ' +
    'checked. Ask this when you know what a subject looks like but not what it is called, ' +
    'before `variance_describe` or `variance_composition {subject}`. A word no subject holds ' +
    'is answered with the names the suite does use. Each hit carries the place behind it — the ' +
    'landmark saying those words, the file and the line it is declared at — so the answer ends ' +
    'where the work starts. A `query` carrying a relation — *the warning under the Carrier ' +
    'field on the dispatch drawer* — is answered by the arrangement the same run recorded.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Words naming the subject: a story id fragment, a component, a label, visible text. ' +
          'Say `under`, `above`, `inside`, `left of`, `right of` or `beside` to ask where on a ' +
          'surface something sits rather than which surface it is.',
      },
      from: {
        type: 'string',
        description:
          'Optional. Which files to answer from, as a real path and only a real path: ' +
          '`app/dispatch/page.tsx` is that file, `app/dispatch/*` that folder\'s own files, ' +
          '`app/dispatch/` everything under it. Those three forms and no others — a `*` ' +
          'anywhere but the last segment is a pattern, not a path. A path exists or it does ' +
          'not: read from the root down, segment for whole segment, case included, against the ' +
          'files each subject was seen in. Nothing is looked for inside a path, so `Badge.tsx` ' +
          'is not the file under `apps/web` — it is a file at the root, and where none is ' +
          'there the start point is rejected as not found. Say `apps/web/Badge.tsx`. Several ' +
          'paths are several entry points and are taken together. No answer is ever given from ' +
          'outside it. Narrows the suite before ' +
          'ranking and recounts rarity inside what remains, so the area\'s own vocabulary stops ' +
          'distinguishing anything.',
      },
      limit: {
        type: 'integer',
        description: 'Optional. How many subjects to print; the rest are counted. Default 8.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },

  run(report, input) {
    const query = stringArg(input, 'query');
    const from = typeof input['from'] === 'string' && input['from'].trim() !== '' ? input['from'] : undefined;
    const limit = typeof input['limit'] === 'number' && input['limit'] > 0 ? Math.floor(input['limit']) : DEFAULT_LIMIT;

    // One door. The lexicon holds the words and the arrangement, written by one
    // walk of one run, so a question about where something sits is not another
    // tool — it is this one reading the other half of the record it already has.
    // The relation word in the question is what says which half to read.
    if (readQuestion(query).relation !== undefined) {
      const answer = orient(report, query, from);
      if (answer.surfaces > 0) return renderOrientation(answer, limit);
    }

    return render(report, locateSubjects(report, query, from), query, limit);
  },
};

const DEFAULT_LIMIT = 8;

/**
 * The one line `variance_summary` gives the lexicon.
 *
 * Same rule as the narrowing line beside it: an option nobody is told about is
 * an option nobody has. An agent reading a summary of a suite too large to list
 * holds descriptions and no ids, and nothing else in the header says that the
 * run wrote the names down. Omitted when it did not, because the sentence would
 * then be an invitation to spend a call learning that.
 */
export function indexed(report: RunReport): readonly string[] {
  const lexicon = report.lexicon;
  if (lexicon === undefined) return [];
  return [
    `names of ${lexicon.subjects.length} subject(s) written down over ${lexicon.fields.length} ` +
      'field(s); `variance_locate {query}` finds a subject from a description',
  ];
}

/**
 * Field weights. Integers, and the order is the argument: a word in the id or in
 * the component a subject is the example of names the subject; in a label or
 * its text, names what it shows; in a component or creator, names what it is
 * built from; in a region or file, names where its code is; a role or token is
 * the weakest, because `button` is a role in most of a suite.
 */
export const FIELD_WEIGHTS: Readonly<Record<LocateField, number>> = {
  id: 6,
  example: 6,
  names: 4,
  text: 4,
  components: 3,
  createdBy: 3,
  regions: 2,
  files: 2,
  roles: 1,
  tokens: 1,
};

/** One field a query term matched in one subject, and the values it matched. */
export interface LocateMatch {
  readonly term: string;
  readonly field: LocateField;
  readonly values: readonly string[];
}

export interface LocateHit {
  readonly subject: string;
  readonly boundaries: number;
  /** Components this subject is the narrow example of. */
  readonly example: readonly string[];
  readonly matches: readonly LocateMatch[];
  /** Distinct query terms matched. The first rank key. */
  readonly terms: number;
  /** Σ over matched (term, field) of weight × rarity of the term in that field. The second rank key. */
  readonly weight: number;
}

export interface Located {
  /** The query's terms after the stoplist, as typed, lowercased, deduplicated. */
  readonly terms: readonly string[];
  /** Words the stoplist dropped. */
  readonly dropped: readonly string[];
  /** Terms no subject holds in any field that was read. */
  readonly unmatched: readonly string[];
  /** Fields the run read. `id` is always among them. */
  readonly read: readonly LocateField[];
  /** Fields the run did not read, so a miss there is not a miss. */
  readonly unread: readonly LexiconField[];
  /** Subjects indexed, over all fields or by id alone. */
  readonly indexed: number;
  /** Subjects the run indexed by id only, because it wrote no lexicon for them. */
  readonly idOnly: number;
  /**
   * Terms the best hit matched, of `terms.length`. Below it, no subject holds
   * the whole question and the answer says so: the hits cover a word of it.
   */
  readonly cover: number;
  /** Every hit, ranked. The printer applies the limit. */
  readonly hits: readonly LocateHit[];
  /** The suite's accessible names, for a term that matched nothing. */
  readonly names: readonly string[];
  /** The start point, when one was given, resolved. */
  readonly scope?: Scope;
}

/**
 * Ten function words and nothing else. Closed, in code, because a stoplist is a
 * rule about the query and a rule is printed, not tuned.
 */
const STOPLIST: ReadonlySet<string> = new Set(['the', 'a', 'an', 'in', 'on', 'of', 'with', 'and', 'for', 'to']);

/**
 * The lookup, as a value: the tool prints this and a measurement reads it.
 */
export function locateSubjects(report: RunReport, query: string, from?: string): Located {
  const index = indexOf(report);
  const scope = from === undefined ? undefined : scopeOf(report, from);
  // A boundary, not a preference. A start point that named nowhere leaves an
  // empty scope and an empty scope is searched empty: answering out of the
  // files the caller ruled out would be answering a question nobody asked.
  const within = scope === undefined ? undefined : scope.subjects;

  // A word is what sits between spaces with the punctuation around it gone:
  // `withTracking),` is `withtracking`, and prints as what it matched.
  const words = query
    .split(/\s+/)
    .map((word) => lower(word).replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
    .filter((word) => word !== '');
  const dropped = [...new Set(words.filter((word) => STOPLIST.has(word)))];
  const terms = [...new Set(words.filter((word) => !STOPLIST.has(word)))];

  // Every (subject, term, field) match first, because rarity is a count over
  // subjects per (term, field) and the score needs it before any subject is
  // scored. `holders` is per term, for the words nothing holds at all. Entry
  // ids ascend in subject, field, value order, so one pass groups them.
  const matched = new Map<string, LocateMatch[]>();
  const holders = new Map<string, Set<string>>();
  const holdersIn = new Map<string, Set<string>>();
  for (const term of terms) {
    const parts = partsOf(term);
    if (parts.length === 0) continue;
    let open: { subject: string; field: LocateField; values: string[] } | undefined;
    const close = () => {
      if (open === undefined) return;
      let list = matched.get(open.subject);
      if (list === undefined) matched.set(open.subject, (list = []));
      list.push({ term, field: open.field, values: open.values });
      let set = holders.get(term);
      if (set === undefined) holders.set(term, (set = new Set()));
      set.add(open.subject);
      let inField = holdersIn.get(`${open.field} ${term}`);
      if (inField === undefined) holdersIn.set(`${open.field} ${term}`, (inField = new Set()));
      inField.add(open.subject);
    };
    for (const id of entriesMatching(index, parts)) {
      const entry = index.entries[id]!;
      if (within !== undefined && !within.has(entry.subject)) continue;
      if (open !== undefined && open.subject === entry.subject && open.field === entry.field) {
        open.values.push(entry.value);
        continue;
      }
      close();
      open = { subject: entry.subject, field: entry.field, values: [entry.value] };
    }
    close();
  }

  // Counted over the scope when there is one. This is the half of a start
  // point that removing rows does not buy: inside one area of an application,
  // the area's own vocabulary stops distinguishing anything.
  const total = within === undefined ? index.subjects.size : within.size;
  const rarity = (term: string, field: LocateField): number =>
    Math.floor((1000 * (total - (holdersIn.get(`${field} ${term}`)?.size ?? 0) + 1)) / (total + 1));

  const hits: LocateHit[] = [...matched].map(([subject, list]) => ({
    subject,
    boundaries: index.subjects.get(subject)?.boundaries ?? 0,
    example: index.examples.get(subject) ?? index.subjects.get(subject)?.terms.example ?? [],
    matches: list,
    terms: new Set(list.map((match) => match.term)).size,
    weight: list.reduce((sum, match) => sum + FIELD_WEIGHTS[match.field] * rarity(match.term, match.field), 0),
  }));
  hits.sort(
    (left, right) =>
      right.terms - left.terms ||
      right.weight - left.weight ||
      left.boundaries - right.boundaries ||
      codeUnit(left.subject, right.subject),
  );

  return {
    terms,
    dropped,
    unmatched: terms.filter((term) => !holders.has(term)),
    read: index.read,
    unread: index.unread,
    indexed: index.subjects.size,
    idOnly: index.idOnly,
    cover: hits[0]?.terms ?? 0,
    hits,
    names: index.names,
    ...(scope === undefined ? {} : { scope }),
  };
}

/** Why a field is absent from a report, said per field. */
const WHY_UNREAD: Readonly<Record<LexiconField, string>> = {
  example: 'no composition',
  names: 'no semantic snapshot',
  text: 'no semantic snapshot',
  components: 'no boundaries',
  createdBy: 'no boundaries',
  regions: 'no execution journal was read',
  files: 'no source index and no provenance',
  roles: 'no semantic snapshot',
  tokens: 'no boundaries',
};

const MAX_VALUES_SHOWN = 3;
const MAX_NAMES_SHOWN = 24;

function render(report: RunReport, located: Located, query: string, limit: number): string {
  const sections: string[] = [headline(located, query)];

  if (located.hits.length > 0) {
    const shown = located.hits.slice(0, limit);
    // Only the rows about to be printed are read for a place. The rest were
    // ranked on their names and are counted, not shown, so reading their
    // arrangement would be work nobody sees.
    const places = placesOn(report, shown.map((hit) => hit.subject), query);
    sections.push(shown.map((hit) => renderHit(hit, places.get(hit.subject))).join('\n'));
    const rest = located.hits.slice(limit);
    if (rest.length > 0) {
      sections.push(`…and ${rest.length} more: ${preview(rest.map((hit) => hit.subject), 6)}`);
    }
  }

  if (located.unmatched.length > 0) sections.push(unmatchedSection(located));

  const top = located.hits[0];
  if (top !== undefined) {
    sections.push(
      `next: variance_composition {subject: "${top.subject}"} · variance_describe {subject: "${top.subject}"}`,
    );
  }

  return sections.join('\n\n');
}

function headline(located: Located, query: string): string {
  const count = located.hits.length;
  const asked = located.terms.length;
  const best = located.cover;
  const tail = located.dropped.length === 0 ? '.' : `; ${list(located.dropped)} not indexed.`;
  const first =
    asked === 0
      ? `Nothing left of \`${query}\` after the stoplist dropped ${list(located.dropped)}.`
      : count === 0
        ? `No subject of ${located.indexed} matches \`${query}\`.`
        : best < asked
          ? // Partial cover is the answer a large suite gives to a question it
            // cannot take. Saying *n subjects match* would be false: they match
            // a word of it. On fifteen subjects there was nothing to half-match
            // and the distinction never showed; on five thousand a question
            // about something the suite does not have still draws hundreds.
            `No subject of ${located.indexed} matches all ${asked} terms of \`${query}\`. ` +
            `The best cover is ${best} of ${asked}, over ${count} subject(s)${tail}`
          : `${count} of ${located.indexed} subject(s) match \`${query}\`${tail}`;

  const scope = located.scope === undefined ? '' : `\n${scopeLine(located.scope, located.indexed)}`;
  const read = `Read: ${located.read.join(', ')}.`;
  const unread =
    located.unread.length === 0
      ? ''
      : ` Not read: ${located.unread.map((field) => `${field} (${WHY_UNREAD[field]})`).join(', ')}.`;

  const idOnly =
    located.idOnly === 0
      ? ''
      : located.idOnly === located.indexed
        ? '\nThis run indexed subject ids and nothing else — it carries no lexicon, which a ' +
          'raster-only or ephemeral run does not write — so a miss below is not a miss on ' +
          'text, names, components or regions; none was searched.'
        : `\n${located.idOnly} subject(s) are indexed by id alone: the run composed nothing for them.`;

  return `${first}${scope}\n${read}${unread}${idOnly}`;
}

function renderHit(hit: LocateHit, place: string | undefined): string {
  const byTerm = new Map<string, LocateMatch[]>();
  for (const match of hit.matches) {
    let list = byTerm.get(match.term);
    if (list === undefined) byTerm.set(match.term, (list = []));
    list.push(match);
  }

  const head =
    `${hit.subject} · ${hit.boundaries} boundar${hit.boundaries === 1 ? 'y' : 'ies'}` +
    (hit.example.length === 0 ? '' : ` · example of ${hit.example.join(', ')}`);

  return [
    head,
    ...(place === undefined ? [] : [`  where: ${place}`]),
    ...[...byTerm].map(
      ([term, matches]) =>
        `  ${term}: ` +
        matches
          .map((match) => `${match.field} ${preview(match.values.map((value) => `\`${value}\``), MAX_VALUES_SHOWN)}`)
          .join('; '),
    ),
  ].join('\n');
}

function unmatchedSection(located: Located): string {
  const words = list(located.unmatched);
  const verb = located.unmatched.length === 1 ? 'occurs' : 'occur';
  if (located.names.length === 0) {
    return `${words} ${verb} in no field that was read. This run recorded no accessible names to offer instead.`;
  }
  return (
    `${words} ${verb} in no field that was read. The names this run did record:\n  ` +
    preview(located.names, MAX_NAMES_SHOWN, ' · ')
  );
}

function list(values: readonly string[]): string {
  return values.map((value) => `\`${value}\``).join(', ');
}

function preview(values: readonly string[], limit: number, separator = ', '): string {
  const shown = values.slice(0, limit).join(separator);
  return values.length > limit ? `${shown}${separator}+${values.length - limit}` : shown;
}
