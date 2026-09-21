import MiniSearch from 'minisearch';
import type { Tool } from '@variance-authority/mcp/tools';
import { START_POINT_SCHEMA, startPointArg, stringArg } from '@variance-authority/mcp/tools';
import type { Documented, Entry, Help, Named, Opening, Use } from '@variance-authority/package/help';
import { everyEntry } from '@variance-authority/package/help';
import { areaLine, areaOf } from './area.js';
import { specifierOf } from './find.js';
import { line } from './format.js';

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

/** One published name, as `everyEntry` yields it. */
type Row = readonly [Documented, Opening, Entry];

/** The same, carrying what the area saw of it — nothing, when there is no area. */
type Shown = readonly [...Row, ScopedUse | undefined];

function matches(entry: Entry, query: string): boolean {
  return entry.name.toLowerCase().includes(query) || (entry.doc ?? '').toLowerCase().includes(query);
}

interface ScopedUse {
  readonly sites: readonly Use[];
  readonly files: number;
  readonly byDistance: readonly (readonly [number, number])[];
}

/** Import sites of one published name that are actually written in the area. */
function usedWithin(entry: Entry, area: ReturnType<typeof areaOf>): ScopedUse {
  const sites = entry.sites.filter((site) => area.files.has(site.at));
  const files = new Set(sites.map((site) => site.at));
  const distance = new Map<number, number>();
  for (const file of files) {
    const hops = area.distance.get(file);
    if (hops !== undefined) distance.set(hops, (distance.get(hops) ?? 0) + 1);
  }
  return { sites, files: files.size, byDistance: [...distance].sort(([a], [b]) => a - b) };
}

function scopedLine(entry: Entry, scoped: ScopedUse): string {
  const said = entry.doc === undefined ? 'UNDOCUMENTED' : entry.doc.split('\n')[0];
  const distances = scoped.byDistance.map(([at, files]) => `${at}: ${files}`).join(', ');
  const fileWord = scoped.files === 1 ? 'file' : 'files';
  const importWord = scoped.sites.length === 1 ? 'import' : 'imports';
  const packageWord = entry.usedBy.length === 1 ? 'package' : 'packages';
  const globalImportWord = entry.uses === 1 ? 'import' : 'imports';
  return (
    `${entry.name} [${entry.kind}] ${scoped.files} ${fileWord}, ${scoped.sites.length} ${importWord} in this area ` +
    `(files by distance: ${distances}); globally ${entry.usedBy.length} ${packageWord}, ${entry.uses} ${globalImportWord} — ${said}`
  );
}

/**
 * Published names a rule accepts, in the order the surface is always read in.
 *
 * The rule is a predicate rather than the query because the same ordering has
 * to hold for names the substring found and names the loose pass added. Two
 * orderings would be two answers, and the second would look like a ranking.
 *
 * The area enters here rather than at the call sites for the same reason: it
 * decides both what is admitted and how what is admitted is ordered, and a
 * second pass that applied only one of the two would answer a scoped question
 * with an unscoped ranking.
 */
function surface(
  help: Help,
  hit: (entry: Entry) => boolean,
  area: ReturnType<typeof areaOf> | undefined,
): readonly Shown[] {
  return [...everyEntry(help)]
    .filter(([, , entry]) => hit(entry))
    .map(([owner, held, entry]) =>
      [owner, held, entry, area === undefined ? undefined : usedWithin(entry, area)] as const,
    )
    // A published name with no import site in the closure is a name the area
    // does not use, however well it matches the word.
    .filter(([, , , scoped]) => scoped === undefined || scoped.sites.length > 0)
    .sort(
      ([, , a, scopedA], [, , b, scopedB]) =>
        (scopedB?.files ?? 0) - (scopedA?.files ?? 0) ||
        (scopedB?.sites.length ?? 0) - (scopedA?.sites.length ?? 0) ||
        b.usedBy.length - a.usedBy.length ||
        b.uses - a.uses ||
        (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
    );
}

const shownAs = ([owner, held, entry, scoped]: Shown): string =>
  `${specifierOf(owner, held)} · ${scoped === undefined ? line(entry) : scopedLine(entry, scoped)}`;

/**
 * Exported names a rule accepts, one line each, nearest thing to a ranking.
 *
 * Grouped by name because one name exported from a barrel and from the file that
 * declares it is one thing to go and look at, and ordered by how many files
 * export it — which is the only count this half has. Source before tests and
 * stories within a name, so the place shown first is the implementation rather
 * than something exercising it.
 */
function elsewhere(
  help: Help,
  hit: (name: string) => boolean,
  shown: ReadonlySet<string>,
  within: ReadonlySet<string> | undefined,
): readonly string[] {
  const found = new Map<string, Named[]>();

  for (const name of help.exported) {
    if (shown.has(name.name) || !hit(name.name)) continue;
    // The file that exports it, against the closure. A name exported from a
    // barrel inside the area and declared outside it arrives here twice, under
    // two paths, and the one in the area is the one a reader can open.
    if (within !== undefined && !within.has(name.at)) continue;
    const held = found.get(name.name) ?? [];
    found.set(name.name, held);
    held.push(name);
  }

  const order = { source: 0, test: 1, story: 2 };
  return [...found]
    .sort(([a, at], [b, bt]) => bt.length - at.length || (a < b ? -1 : a > b ? 1 : 0))
    .map(([name, places]) => {
      const [first, ...rest] = [...places].sort((a, b) => order[a.kind] - order[b.kind]);
      if (first === undefined) return name;
      const more = rest.length === 0 ? '' : ` (+${rest.length} more ${rest.length === 1 ? 'file' : 'files'})`;
      return `${name} — ${first.by === '' ? 'the repository' : first.by} · ${first.at}:${first.line}${more}`;
    });
}

/**
 * Names the words reach when they are allowed apart and allowed to be wrong.
 *
 * Both halves of the checkout go in, under the area that already applies, and
 * the names the substring answered are kept out — a name the caller can already
 * see must not be offered back to them as something else. Published names carry
 * their documentation in; exported names carry a name and nothing else, because
 * nothing else was read for them, and the index is not a reason to read more.
 *
 * What comes back is a set and not a list. Whether a name is in the answer is
 * this index's to say; where it sits is not.
 */
function loosely(
  help: Help,
  query: string,
  within: ReadonlySet<string> | undefined,
  already: (name: string) => boolean,
): ReadonlySet<string> {
  const held = new Map<string, string>();

  const keep = (name: string, doc: string, at: string): void => {
    if (already(name) || (within !== undefined && !within.has(at))) return;
    const written = held.get(name) ?? '';
    held.set(name, doc === '' ? written : `${written} ${doc}`);
  };

  for (const [, , entry] of everyEntry(help)) keep(entry.name, entry.doc ?? '', entry.at);
  for (const name of help.exported) keep(name.name, '', name.at);
  if (held.size === 0) return new Set();

  const index = new MiniSearch<{ id: number; name: string; doc: string }>({
    fields: ['name', 'doc'],
    processTerm: (term) => (term.length < 2 ? null : term.toLowerCase()),
  });
  const names = [...held.keys()];
  index.addAll(names.map((name, id) => ({ id, name, doc: held.get(name) ?? '' })));

  // Every word has to land somewhere, or a two-word query answers with
  // everything either word touched — which is the failure this whole tool is
  // arranged against.
  const hits = index.search(query, { combineWith: 'AND', fuzzy: FUZZY, prefix: true });
  return new Set(hits.map((hit) => names[hit.id as number] ?? ''));
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
    'you are standing: `from` a path answers with published names imported by the files that ' +
    'path reaches, ordered by the importing files in that area; `to` does the same for files ' +
    'that reach the path. Internal exports are filtered by their declaring file. An empty ' +
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
          `${START_POINT_SCHEMA.to.description} This is the direction that finds a caller when ` +
          'the callee is what you have: `to` the helper, `query` the word you expect around it.',
      },
    },
    required: ['query'],
    additionalProperties: false,
  },

  // The tree is a walk of the repository, so it is read when a question names a
  // path and never on the way past.
  wants: (input) => startPointArg(input, 'from') !== undefined || startPointArg(input, 'to') !== undefined,

  run(help, input, invocation) {
    const query = stringArg(input, 'query').toLowerCase();
    const said = { from: startPointArg(input, 'from'), to: startPointArg(input, 'to') };

    const area =
      said.from === undefined && said.to === undefined
        ? undefined
        : areaOf(said.from, said.to, invocation?.tree);

    // A start point that could not be resolved is refused whole. Answering the
    // unscoped question instead would hand back four hundred names under a
    // header the caller has every reason to read as *in your area*.
    if (area?.refused !== undefined) return areaLine(area);
    const within = area?.files;

    const found = surface(help, (entry) => matches(entry, query), area);
    const answered = new Set(found.map(([, , entry]) => entry.name));
    const rest = elsewhere(help, (name) => name.toLowerCase().includes(query), answered, within);

    // A name is already answered when either half returned it — the surface by
    // its name or its doc, the rest by its name. Both are the caller's own
    // word, and offering a word back to whoever typed it is not an addition.
    const already = (name: string): boolean => answered.has(name) || name.toLowerCase().includes(query);
    const loose = found.length === 0 && rest.length === 0
      ? loosely(help, query, within, already)
      : new Set<string>();
    const alsoFound = loose.size === 0 ? [] : surface(help, (entry) => loose.has(entry.name), area);
    const alsoRest =
      loose.size === 0
        ? []
        : elsewhere(help, (name) => loose.has(name), new Set(alsoFound.map(([, , e]) => e.name)), within);
    const looser = [...alsoFound.map(shownAs), ...alsoRest];

    const seenLoosely = looser.slice(0, LOOSE_CAP);
    const looseSection =
      looser.length === 0
        ? []
        : [
            '',
            `${looser.length} more ${looser.length === 1 ? 'name matches' : 'names match'} loosely — your words apart, or within a character of the ones written. Nothing above was reordered by this.`,
            '',
            ...seenLoosely,
            ...(looser.length > seenLoosely.length ? [`\n${looser.length - seenLoosely.length} more not shown.`] : []),
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

    const shown = found.slice(0, CAP);
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
            ...shown.map(shownAs),
            ...more,
          ];

    if (rest.length === 0) return [...where, ...heads, ...looseSection].join('\n');

    const seen = rest.slice(0, ELSEWHERE_CAP);
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
  },
};
