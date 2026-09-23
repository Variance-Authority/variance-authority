import type { Tool, Tree } from '@variance-authority/mcp/tools';
import { START_POINT_SCHEMA, startPointArg, stringArg } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import type { PublishedRow, SearchIndex } from '../search-index.js';
import { encodeSearchIndex, openSearchIndex } from '../search-index.js';
import { areaLine, areaOf } from './area.js';
import { line } from './format.js';
import { looseNames } from './loose.js';

/**
 * `docs_search` — the name for a thing somebody can only describe.
 *
 * Substring, case-insensitive, over the name and over what was written about
 * it. A match there is a fact about the text, so it is reported first, whole,
 * and in the order it has always been in.
 *
 * ## Two halves, because most code is not published
 *
 * The published surface is a few hundred names. The repository exports several
 * thousand, and the extra ones are not private — they are what one file in a
 * package takes from another, and they are where the answer lives whenever the
 * thing being looked for was never something to publish. A search that stopped
 * at the surface would answer *nothing matched* for most of the code in the
 * checkout, which is the same failure as having no search at all.
 *
 * So the answer has two sections and says which is which. A published name is
 * API: it carries a specifier, a doc comment and a count of who imports it, and
 * it can be handed straight to `docs_symbol`. An exported one carries a file and
 * a line and nothing else, because nothing else was read for it — reading three
 * thousand declarations to rank them would cost the whole repository on every
 * question, and the file and the line are enough to go and look.
 *
 * Published names come first and are never repeated below, so a name that is
 * both is reported once, as the API it is.
 *
 * ## A third section, which may only add
 *
 * Substring answers the word you typed and nothing else. It cannot answer a
 * word you typed two characters wrong, and it cannot answer two words that are
 * both written about a name but not written next to each other — `read span`
 * matches no text anywhere, and the declaration it was asking for says both.
 *
 * Those two cases are what the loose pass is for, and they are the whole of
 * what it is for. It is not a better ranking of the sections above: it never
 * scores, reorders, promotes, demotes or removes anything they answered, and it
 * cannot be reached by a name they already returned. It appends names they did
 * not, under a heading that says how they were matched, and when it has nothing
 * to append it prints nothing at all. So an answer that used to be clean stays
 * clean, and *nothing matched* still means the substring matched nothing — now
 * said over a wider net, and saying so.
 *
 * The order inside it is the order the sections above use, by consumers and
 * then by name. The index decides membership; it is never allowed to decide
 * position, because a caller who can see why a name is in a list can check it,
 * and a caller reading a rank has to trust it.
 *
 * ## Where the substring stops being enough
 *
 * On a repository of a few thousand names it is. On a large one it is not, and
 * no ranking fixes that: `order` really is written into four hundred names, the
 * reader wanted the nine in one service, and the text cannot tell those apart
 * because the text is the same. What separates them is a fact the caller holds
 * and the query never carried — which part of the repository they are standing
 * in — so `from` and `to` take it as a path and the closure decides what may be
 * answered. Published names are admitted only when a file in that closure
 * imports them, then ranked by the number of importing files there. Internal
 * exports have no import-site rows, so their declaring file remains the fact
 * that admits them. See [`area.ts`](./area.ts): a boundary, not a preference.
 *
 * The loose pass is inside that boundary and not beside it. It is built from
 * the files the area already allows, so a widening can reach a name the caller
 * did not type and can never reach a file they ruled out.
 */

/** Published matches shown before the answer says it stopped. */
const CAP = 40;

/** Exported matches shown. Lower, because the section below it is the cheaper half. */
const ELSEWHERE_CAP = 25;

/** Loose matches shown. Lowest: these are the ones the caller did not ask for. */
const LOOSE_CAP = 15;

/** How wrong a word may be and still be looked up: about one character in five. */
const FUZZY = 0.2;

type Area = ReturnType<typeof areaOf>;

interface ScopedUse {
  readonly sites: number;
  readonly files: number;
  readonly byDistance: readonly (readonly [number, number])[];
}

/** One published row, keyed by the columns it sorts on — nothing decoded yet. */
interface Hit {
  readonly row: number;
  readonly name: number;
  readonly rank: number;
  readonly usedBy: number;
  readonly uses: number;
  /** What the area saw of it — nothing, when there is no area. */
  readonly scoped: ScopedUse | undefined;
}

/**
 * A list that knows its length and prints only the head it is asked for.
 *
 * Every count an answer states is the count of the whole match, and every line
 * it prints is one of the first few. A two-letter query matches a hundred
 * thousand names; the answer prints twenty-five of them, so the rest are
 * counted and ordered as integers and never decoded.
 */
interface Listed {
  readonly length: number;
  head(count: number): readonly string[];
}

/** The first `count` of `items` under `before`, a total order, without sorting the rest. */
function first<T>(items: readonly T[], count: number, before: (a: T, b: T) => number): T[] {
  const best: T[] = [];
  if (count <= 0) return best;
  for (const item of items) {
    const last = best[best.length - 1];
    if (best.length === count && last !== undefined && before(item, last) >= 0) continue;
    let low = 0;
    let high = best.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (before(best[middle] as T, item) <= 0) low = middle + 1;
      else high = middle;
    }
    best.splice(low, 0, item);
    if (best.length > count) best.pop();
  }
  return best;
}

/** Import sites of one published name that are actually written in the area. */
function usedWithin(index: SearchIndex, row: number, area: Area, inArea: ReadonlySet<number>): ScopedUse {
  const sites = [...index.siteFiles(row)].filter((at) => inArea.has(at));
  const files = new Set(sites);
  const distance = new Map<number, number>();
  for (const file of files) {
    const hops = area.distance.get(index.file(file));
    if (hops !== undefined) distance.set(hops, (distance.get(hops) ?? 0) + 1);
  }
  return { sites: sites.length, files: files.size, byDistance: [...distance].sort(([a], [b]) => a - b) };
}

function scopedLine(entry: PublishedRow, scoped: ScopedUse): string {
  const said = entry.doc === undefined ? 'UNDOCUMENTED' : entry.doc.split('\n')[0];
  const distances = scoped.byDistance.map(([at, files]) => `${at}: ${files}`).join(', ');
  const fileWord = scoped.files === 1 ? 'file' : 'files';
  const importWord = scoped.sites === 1 ? 'import' : 'imports';
  const packageWord = entry.usedBy.length === 1 ? 'package' : 'packages';
  const globalImportWord = entry.uses === 1 ? 'import' : 'imports';
  return (
    `${entry.name} [${entry.kind}] ${scoped.files} ${fileWord}, ${scoped.sites} ${importWord} in this area ` +
    `(files by distance: ${distances}); globally ${entry.usedBy.length} ${packageWord}, ${entry.uses} ${globalImportWord} — ${said}`
  );
}

/**
 * Published rows, in the order the surface is always read in.
 *
 * The rows arrive as a set rather than a rule because the same ordering has
 * to hold for names the substring found and names the loose pass added. Two
 * orderings would be two answers, and the second would look like a ranking.
 * The last key is the row, which is the order `everyEntry` walks, so ties land
 * where the stable sort over that walk always put them.
 *
 * The area enters here rather than at the call sites for the same reason: it
 * decides both what is admitted and how what is admitted is ordered, and a
 * second pass that applied only one of the two would answer a scoped question
 * with an unscoped ranking.
 */
function surface(
  index: SearchIndex,
  rows: Iterable<number>,
  area: Area | undefined,
  inArea: ReadonlySet<number> | undefined,
): readonly Hit[] {
  const hits: Hit[] = [];
  for (const row of new Set(rows)) {
    const scoped = area === undefined || inArea === undefined ? undefined : usedWithin(index, row, area, inArea);
    // A published name with no import site in the closure is a name the area
    // does not use, however well it matches the word.
    if (scoped !== undefined && scoped.sites === 0) continue;
    const name = index.publishedName(row);
    hits.push({ row, name, rank: index.rank(name), usedBy: index.usedBy(row), uses: index.uses(row), scoped });
  }
  return hits;
}

const surfaceOrder = (a: Hit, b: Hit): number =>
  (b.scoped?.files ?? 0) - (a.scoped?.files ?? 0) ||
  (b.scoped?.sites ?? 0) - (a.scoped?.sites ?? 0) ||
  b.usedBy - a.usedBy ||
  b.uses - a.uses ||
  a.rank - b.rank ||
  a.row - b.row;

function listed(index: SearchIndex, hits: readonly Hit[]): Listed {
  return {
    length: hits.length,
    head: (count) =>
      first(hits, count, surfaceOrder).map((hit) => {
        const entry = index.published(hit.row);
        return `${entry.specifier} · ${hit.scoped === undefined ? line(entry) : scopedLine(entry, hit.scoped)}`;
      }),
  };
}

/** Every published row of the names given. */
const publishedOf = (index: SearchIndex, names: Iterable<number>): number[] =>
  [...names].flatMap((name) => [...index.publishedOf(name)]);

/**
 * Exported names given by id, one line each, nearest thing to a ranking.
 *
 * Grouped by name because one name exported from a barrel and from the file that
 * declares it is one thing to go and look at, and ordered by how many files
 * export it — which is the only count this half has. Source before tests and
 * stories within a name, so the place shown first is the implementation rather
 * than something exercising it.
 */
function elsewhere(
  index: SearchIndex,
  names: Iterable<number>,
  shown: ReadonlySet<number>,
  within: ReadonlySet<number> | undefined,
): Listed {
  const found: { name: number; rank: number; count: number }[] = [];
  // The file that exports it, against the closure. A name exported from a
  // barrel inside the area and declared outside it arrives here twice, under
  // two paths, and the one in the area is the one a reader can open.
  const rowsOf = (name: number): readonly number[] => {
    const all = index.exportedOf(name);
    return within === undefined ? [...all] : [...all].filter((row) => within.has(index.exportedFile(row)));
  };

  for (const name of names) {
    if (shown.has(name)) continue;
    const count = within === undefined ? index.exportedOf(name).length : rowsOf(name).length;
    if (count > 0) found.push({ name, rank: index.rank(name), count });
  }

  return {
    length: found.length,
    head: (count) =>
      first(found, count, (a, b) => b.count - a.count || a.rank - b.rank).map(({ name, count: files }) => {
        // Source before tests before stories, and the first written within a
        // kind: the kind column orders the rows, and only the one shown is read.
        let chosen: number | undefined;
        for (const row of rowsOf(name)) {
          if (chosen === undefined || index.exportedKind(row) < index.exportedKind(chosen)) chosen = row;
          if (index.exportedKind(chosen) === 0) break;
        }
        if (chosen === undefined) return index.name(name);
        const head = index.exported(chosen);
        const rest = files - 1;
        const more = rest === 0 ? '' : ` (+${rest} more ${rest === 1 ? 'file' : 'files'})`;
        return `${head.name} — ${head.by === '' ? 'the repository' : head.by} · ${head.at}:${head.line}${more}`;
      }),
  };
}

/*
 * The loose pass — names the words reach when they are allowed apart and
 * allowed to be wrong — is `looseNames` in `loose.ts`.
 *
 * Both halves of the checkout go in, under the area that already applies, and
 * the names the substring answered are kept out — a name the caller can already
 * see must not be offered back to them as something else. Published names carry
 * their documentation in; exported names carry a name and nothing else, because
 * nothing else was read for them, and the index is not a reason to read more.
 *
 * What comes back is a set and not a list. Whether a name is in the answer is
 * the dictionary's to say; where it sits is not.
 */

/** The index one Help value encodes to, for callers that hold the value itself. */
const encoded = new WeakMap<Help, SearchIndex>();

export function searchIndexOf(help: Help): SearchIndex {
  let index = encoded.get(help);
  if (index === undefined) encoded.set(help, (index = openSearchIndex(encodeSearchIndex(help))));
  return index;
}

/** The search over an opened index — what `docs_search` answers, without the Help value. */
export function answerSearch(index: SearchIndex, input: Readonly<Record<string, unknown>>, tree?: Tree): string {
  const query = stringArg(input, 'query').toLowerCase();
  const said = { from: startPointArg(input, 'from'), to: startPointArg(input, 'to') };

  const area = said.from === undefined && said.to === undefined ? undefined : areaOf(said.from, said.to, tree);

  // A start point that could not be resolved is refused whole. Answering the
  // unscoped question instead would hand back four hundred names under a
  // header the caller has every reason to read as *in your area*.
  if (area?.refused !== undefined) return areaLine(area);
  const within = area === undefined ? undefined : index.fileIds(area.files);

  const named = index.namesContaining(query);
  const hits = surface(index, [...publishedOf(index, named), ...index.docsContaining(query)], area, within);
  const found = listed(index, hits);
  const answered = new Set(hits.map((hit) => hit.name));
  const rest = elsewhere(index, named, answered, within);

  // A name is already answered when either half returned it — the surface by
  // its name or its doc, the rest by its name. Both are the caller's own
  // word, and offering a word back to whoever typed it is not an addition.
  const loose =
    found.length === 0 && rest.length === 0
      ? looseNames(index, query, FUZZY, within, new Set([...named, ...answered]))
      : new Set<number>();
  const alsoHits = loose.size === 0 ? [] : surface(index, publishedOf(index, loose), area, within);
  const alsoFound = listed(index, alsoHits);
  const alsoRest = elsewhere(index, loose, new Set(alsoHits.map((hit) => hit.name)), within);
  const looser = alsoFound.length + alsoRest.length;

  const seenLoosely = [...alsoFound.head(LOOSE_CAP)];
  seenLoosely.push(...alsoRest.head(LOOSE_CAP - seenLoosely.length));
  const looseSection =
    looser === 0
      ? []
      : [
          '',
          `${looser} more ${looser === 1 ? 'name matches' : 'names match'} loosely — your words apart, or within a character of the ones written. Nothing above was reordered by this.`,
          '',
          ...seenLoosely,
          ...(looser > seenLoosely.length ? [`\n${looser - seenLoosely.length} more not shown.`] : []),
        ];

  // Said before the counts and before the emptiness, because it is what the
  // counts are counts *of*. A reader told `nothing matches` without being told
  // where the tool looked has been handed a fact they cannot place.
  const where = area === undefined ? [] : [areaLine(area), ''];

  if (found.length === 0 && rest.length === 0) {
    const nowhere =
      area === undefined
        ? `Nothing in this repository is named or documented with \`${query}\`. \`packages\` lists every entrypoint; \`entrypoint\` lists what one opens.`
        : `Nothing in reach of that start point is named or documented with \`${query}\`. That is a fact about the area, not about the word — ask again without \`from\`/\`to\` to search the whole workspace.`;
    return [...where, nowhere, ...looseSection].join('\n');
  }

  const shown = found.head(CAP);
  // A capped list that does not say it was capped reads as the whole answer,
  // and the reader's next move — narrow, or ask the entrypoint — depends on
  // knowing which of the two it got.
  const more = found.length > shown.length ? [`\n${found.length - shown.length} more matches not shown.`] : [];

  const heads =
    found.length === 0
      ? [`Nothing published matches \`${query}\`.`]
      : [
          `${found.length} published ${found.length === 1 ? 'match' : 'matches'} for \`${query}\``,
          '',
          ...shown,
          ...more,
        ];

  if (rest.length === 0) return [...where, ...heads, ...looseSection].join('\n');

  const seen = rest.head(ELSEWHERE_CAP);
  const hidden = rest.length > seen.length ? [`\n${rest.length - seen.length} more not shown.`] : [];

  return [
    ...where,
    ...heads,
    '',
    `${rest.length} more ${rest.length === 1 ? 'name is' : 'names are'} exported ${area === undefined ? 'somewhere in the repository' : 'in that area'} without being published:`,
    '',
    ...seen,
    ...hidden,
    ...looseSection,
  ].join('\n');
}

/**
 * The search, as a tool: a `query` and an optional start point, answered in
 * two halves — published names first, then the ones a file exports for its
 * neighbours — as the header above sets out.
 *
 * The word is required and the place is not, never the other way round. A
 * place without a word is not a question, it is a request to be shown
 * everything in reach — and in reach of a folder on a large repository is
 * fifty thousand files' worth of names. Nothing here answers without a
 * question.
 */
export const search: Tool<Help> = {
  name: 'docs_search',
  description:
    'Find names whose name or documentation contains a string, case-insensitive. Published names ' +
    'come first, ordered by how many packages import them, each carrying the import specifier it ' +
    'is published from so it can be passed straight to docs_symbol. Names the repository exports ' +
    'but does not publish follow, with the file and line that exports them. Names that match only ' +
    'loosely — your words apart, or within a character of the ones written — are listed last and ' +
    'labelled, never mixed in. On a large ' +
    'repository a substring alone matches everywhere a product says its own name, so say where ' +
    'you are standing. Carry a path the editor, ticket or stack trace already supplied: `from` ' +
    'answers with published names imported by the files that path reaches; `to` does the same ' +
    'for files that reach a known dependency. Both traverse the resolved module graph at any ' +
    'depth. Internal exports are filtered by their declaring file. An empty ' +
    'answer is a fact about the area. Matching is the substring you typed and nothing else — no ' +
    'synonyms, no stemming, no model — so a repository that calls sign-in `CredentialGate` is ' +
    'not reached by `auth`. Supplying the likely vocabulary is your half: when a query matches ' +
    'nothing, ask again with another candidate name rather than a longer description of the ' +
    'same idea.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Substring to look for in names and docs. One candidate name, not a description: this ' +
          'matches the characters you type, so `auth` finds nothing in a repository that writes ' +
          '`login`, `session` or `credential`, and asking it again in different words changes ' +
          'nothing. Ask each candidate as its own query.',
      },
      from: {
        ...START_POINT_SCHEMA.from,
        description:
          `${START_POINT_SCHEMA.from.description} These are the names in reach of where you ` +
          'are working: pass the file you are editing, or the folder of the feature.',
      },
      to: {
        ...START_POINT_SCHEMA.to,
        description:
          `${START_POINT_SCHEMA.to.description} This is the direction that finds dependent files ` +
          'when the dependency is what you have: `to` the helper, `query` the word you expect around it.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },

  // The tree is a walk of the repository, so it is read when a question names a
  // path and never on the way past.
  wants: (input) => startPointArg(input, 'from') !== undefined || startPointArg(input, 'to') !== undefined,

  run: (help, input, invocation) => answerSearch(searchIndexOf(help), input, invocation?.tree),
};
