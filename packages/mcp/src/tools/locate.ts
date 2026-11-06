import type { LexiconField, RunReport } from '@variance-authority/report';
import { stringArg, type Tool } from './tool.js';
import {
  adjacent,
  codeUnit,
  entriesMatching,
  indexOf,
  lower,
  partsOf,
  type LocateField,
  type LocateIndex,
} from './locate-index.js';
import { orient } from './orient.js';
import { askedFor, STOPLIST } from './question.js';
import { renderOrientation } from './place.js';
import { render } from './locate-print.js';
import { scopeOf, type Scope } from './scope.js';
import { startPointArg, START_POINT_SCHEMA } from './start-point.js';
import { heldWeight, rarity as rarityOf } from './rarity.js';
import type { Tree } from './tree.js';

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
 * the ranking is four integers and a string: how many of the query's words a
 * subject matched, how many adjacent pairs of them it holds in one value, how
 * rare each matched word is in the field it matched in across the suite
 * weighted by that field, then the smaller subject first and the id in
 * code-unit order. No term frequency, because three chips in one
 * footer is a fact about a list and not a better match; no length
 * normalisation, because the size of a subject is already the fourth key; no
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
 * A word more than half the searched subjects hold in a field picks none of
 * them out there — the rule that calls a component more than half a suite
 * holds structure — and every match says so, with how many hold it, so the
 * reader sees which of a hit's words are evidence. When every word of a
 * question is that common wherever it occurs, the answer says nothing was
 * picked out. It does not drop the word from the rank. Measured on questions
 * written for a suite by an author who never saw the index, dropping it lost
 * more first places than it won: a word held by one subject more than half is
 * a cliff, and the subject that held it in its text alone fell behind a decoy
 * that held it in a label too.
 *
 * A pair is two adjacent words of the question, adjacent again in one recorded
 * value: `clear completed` in the label *Clear completed*, not `Clear` in one
 * label and `completed` in another, nor both somewhere in one paragraph. The
 * value is cut as tokens are, so `ClearCompleted` says the pair too, and a
 * stopword between the two is passed over as the question passed it over. It
 * orders subjects that matched the same number of words before weight does,
 * so a pair can pick a subject out where neither of its words alone does.
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
/**
 * One relation argument, described the same way six times.
 *
 * The relation is the argument's name rather than a value in an enum beside it,
 * so there is no pair to get wrong and no spelling to validate: an agent either
 * named `under` or it did not. What each holds is identical — the words naming
 * the anchor — which is why this is one function and not six paragraphs that
 * drift apart.
 *
 * The rules the six share — one relation per question, and no relation read on
 * a run with no layout — are stated once in the tool description and not here,
 * because this text is sent six times in every `tools/list`. The anchor is found
 * first and what stands in the relation to it is measured off the rectangles the
 * run resolved. On a run that resolved none, the answer is where the anchor is,
 * with the relation named as what the run cannot say; it is never read from
 * document order, which would look like an arrangement and is not one.
 */
function relationArgument(relation: string, extra?: string): Readonly<Record<string, unknown>> {
  return {
    type: 'string',
    description: `Optional. Words naming the anchor the thing sits ${relation}.${extra === undefined ? '' : ` ${extra}`}`,
  };
}

export const locate: Tool = {
  name: 'variance_locate',
  description:
    'Which subjects a description names. Ranks subjects whose recorded names — id, component, ' +
    'accessible names and text, the components it holds, covered code regions, files, roles, ' +
    'design tokens — match the words of `query`, with the field behind each hit and the file ' +
    'and line it is declared at. Use it before `variance_describe` or `variance_composition ' +
    '{subject}`. Matching is lexical: no syntax, no synonyms, no stemming past a trailing plural. ' +
    'If a word misses, the answer lists the names the suite does use; ask again in another kind ' +
    'of name — on-screen text, component, file. To ask where on a surface something sits, name ' +
    'the anchor in one of `under`, `above`, `inside`, `beside`, `leftOf`, `rightOf`, and the ' +
    'surface in `on`: `{query: "warning", under: "Carrier", on: "dispatch drawer"}`. One ' +
    'relation argument per question. On a run that resolved no layout, the answer is where the ' +
    'anchor is, and it says the run cannot tell what sits in that relation to it.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Words naming the thing wanted: a story id fragment, a component, a label, visible ' +
          'text. Never read as syntax, so `Under review` is two words to search for.',
      },
      under: relationArgument('beneath'),
      above: relationArgument('above'),
      inside: relationArgument('inside', 'Needs no layout.'),
      beside: relationArgument('beside'),
      leftOf: relationArgument('left of'),
      rightOf: relationArgument('right of'),
      on: {
        type: 'string',
        description:
          'Optional. Words naming the surface — `dispatch drawer` — when the anchor could be on ' +
          'several. Needs a relation argument; alone it is refused.',
      },
      from: {
        ...START_POINT_SCHEMA.from,
        description:
          `${START_POINT_SCHEMA.from.description} Narrows the suite before ranking; rarity is ` +
          'recounted inside what remains.',
      },
      to: {
        ...START_POINT_SCHEMA.to,
        description:
          `${START_POINT_SCHEMA.to.description} Finds the screen behind a component: \`to\` the ` +
          'user select, `query` the settings page.',
      },
      limit: {
        type: 'integer',
        description: 'Optional. How many subjects to print; the rest are counted. Default 8.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },

  wants: (input) => startPointArg(input, 'from') !== undefined || startPointArg(input, 'to') !== undefined,

  run(report, input, invocation) {
    const query = stringArg(input, 'query');
    const from = startPointArg(input, 'from');
    const to = startPointArg(input, 'to');
    const tree = invocation?.tree;
    const limit = typeof input['limit'] === 'number' && input['limit'] > 0 ? Math.floor(input['limit']) : DEFAULT_LIMIT;

    // One door. The lexicon holds the words and the arrangement, written by one
    // walk of one run, so a question about where something sits is not another
    // tool — it is this one reading the other half of the record it already has.
    // Which half is read is decided by whether a relation was named, and a
    // relation is only ever named: nothing in `query` chooses it.
    const asked = askedFor(query, input);
    if (asked.relation !== undefined) {
      const answer = orient(report, asked, from, tree, to);
      if (answer.surfaces > 0) return renderOrientation(answer, limit);
    }

    return render(report, locateSubjects(report, query, from, tree, to), query, limit);
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

/** One field a query term, or a pair of them, matched in one subject, and the values it matched. */
export interface LocateMatch {
  readonly term: string;
  readonly field: LocateField;
  readonly values: readonly string[];
  /** Subjects searched that hold the term in this field. */
  readonly holders: number;
  /** `holders` is more than half the subjects searched: the match picks none of them out. */
  readonly common: boolean;
}

export interface LocateHit {
  readonly subject: string;
  readonly boundaries: number;
  /** Components this subject is the narrow example of. */
  readonly example: readonly string[];
  readonly matches: readonly LocateMatch[];
  /** Adjacent pairs of query terms this subject holds in one value, as `a b`. */
  readonly together: readonly LocateMatch[];
  /** Distinct query terms matched. The first rank key. */
  readonly terms: number;
  /** Distinct adjacent pairs of query terms held. The second rank key. */
  readonly pairs: number;
  /** Σ over matched (term, field) of weight × rarity of the term in that field. The third rank key. */
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
  /** Subjects searched: the scope when one was given, else every subject indexed. */
  readonly searched: number;
  /** Terms matched only where more than half the subjects searched hold them. */
  readonly common: readonly string[];
  /**
   * Whether anything asked picks a subject out: a term matched somewhere fewer
   * than half the searched subjects hold it, or a pair any hit says side by
   * side that fewer than half say. False is the answer that abstains.
   */
  readonly distinguished: boolean;
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
 * The lookup, as a value: the tool prints this and a measurement reads it.
 */
export function locateSubjects(
  report: RunReport,
  query: string,
  from?: string | readonly string[],
  tree?: Tree,
  to?: string | readonly string[],
): Located {
  const index = indexOf(report);
  const scope =
    from === undefined && to === undefined ? undefined : scopeOf(report, from, tree, to);
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
  const kept = words.filter((word) => !STOPLIST.has(word));
  const terms = [...new Set(kept)];

  // A pair is two adjacent words of what was asked, the stoplist gone, so
  // `clear the completed` still pairs `clear` with `completed`.
  const pairs = [
    ...new Set(
      kept.slice(1).flatMap((word, at) => (word === kept[at] ? [] : [`${kept[at]} ${word}`])),
    ),
  ];

  // Counted over the scope when there is one. This is the half of a start
  // point that removing rows does not buy: inside one area of an application,
  // the area's own vocabulary stops distinguishing anything.
  const total = within === undefined ? index.subjects.size : within.size;
  const single = collect(index, terms, within, total);
  const together = collect(index, pairs, within, total);
  const rarity = (match: LocateMatch): number => rarityOf(total, match.holders);

  const hits: LocateHit[] = [...single.matched].map(([subject, list]) => {
    const held = together.matched.get(subject) ?? [];
    return {
      subject,
      boundaries: index.subjects.get(subject)?.boundaries ?? 0,
      example: index.examples.get(subject) ?? index.subjects.get(subject)?.terms.example ?? [],
      matches: list,
      together: held,
      terms: new Set(list.map((match) => match.term)).size,
      pairs: new Set(held.map((match) => match.term)).size,
      weight: heldWeight(list, rarity, (match) => FIELD_WEIGHTS[match.field]),
    };
  });
  hits.sort(
    (left, right) =>
      right.terms - left.terms ||
      right.pairs - left.pairs ||
      right.weight - left.weight ||
      left.boundaries - right.boundaries ||
      codeUnit(left.subject, right.subject),
  );

  return {
    terms,
    dropped,
    unmatched: terms.filter((term) => !single.held.has(term)),
    read: index.read,
    unread: index.unread,
    indexed: index.subjects.size,
    searched: total,
    common: single.common,
    distinguished: single.common.length < single.held.size || together.common.length < together.held.size,
    idOnly: index.idOnly,
    cover: hits[0]?.terms ?? 0,
    hits,
    names: index.names,
    ...(scope === undefined ? {} : { scope }),
  };
}

/**
 * Every (subject, term, field) match, grouped by subject, with how many
 * searched subjects hold the term in that field. Rarity and the count of
 * holders are both over subjects per (term, field), so every match is found
 * before any is weighed. A pair is held where one value says its two words
 * next to each other. Entry ids ascend in subject, field, value order, so one pass groups.
 */
function collect(
  index: LocateIndex,
  terms: readonly string[],
  within: ReadonlySet<string> | undefined,
  total: number,
): { matched: Map<string, LocateMatch[]>; held: Set<string>; common: readonly string[] } {
  const found: { subject: string; term: string; field: LocateField; values: string[] }[] = [];
  const holdersIn = new Map<string, number>();
  for (const term of terms) {
    const words = term.split(' ');
    const parts = words.flatMap((word) => partsOf(word));
    if (parts.length === 0) continue;
    let open: (typeof found)[number] | undefined;
    for (const id of entriesMatching(index, parts)) {
      const entry = index.entries[id]!;
      if (within !== undefined && !within.has(entry.subject)) continue;
      if (words.length > 1 && !adjacent(entry.value, words, STOPLIST)) continue;
      if (open !== undefined && open.subject === entry.subject && open.field === entry.field) {
        open.values.push(entry.value);
        continue;
      }
      open = { subject: entry.subject, term, field: entry.field, values: [entry.value] };
      found.push(open);
      holdersIn.set(`${entry.field} ${term}`, (holdersIn.get(`${entry.field} ${term}`) ?? 0) + 1);
    }
  }

  const matched = new Map<string, LocateMatch[]>();
  const held = new Set<string>();
  const distinct = new Set<string>();
  for (const { subject, term, field, values } of found) {
    const holders = holdersIn.get(`${field} ${term}`)!;
    let list = matched.get(subject);
    if (list === undefined) matched.set(subject, (list = []));
    list.push({ term, field, values, holders, common: holders * 2 > total });
    held.add(term);
    if (holders * 2 <= total) distinct.add(term);
  }
  return { matched, held, common: terms.filter((term) => held.has(term) && !distinct.has(term)) };
}
