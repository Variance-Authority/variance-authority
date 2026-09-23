import type { Tool, Tree } from '@variance-authority/mcp/tools';
import { START_POINT_SCHEMA, startPointArg, stringArg } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import type { SearchIndex } from '../search-index.js';
import { encodeSearchIndex, openSearchIndex } from '../search-index.js';
import { areaLine } from './area.js';
import type { ExportedMatch, PublishedMatch } from './search-answer.js';
import { searched } from './search-answer.js';

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
 * word one character off the name, and it cannot answer two words that are
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

/** One published match, as the text answer has always written it. */
function publishedLine(match: PublishedMatch): string {
  const { inArea } = match;
  const said = match.summary ?? 'UNDOCUMENTED';
  if (inArea === undefined) {
    return `${match.specifier} · ${match.name} [${match.kind}] ${match.packages} packages, ${match.imports} imports — ${said}`;
  }
  const distances = inArea.filesByDistance.map(([at, files]) => `${at}: ${files}`).join(', ');
  const fileWord = inArea.files === 1 ? 'file' : 'files';
  const importWord = inArea.imports === 1 ? 'import' : 'imports';
  const packageWord = match.packages === 1 ? 'package' : 'packages';
  const globalImportWord = match.imports === 1 ? 'import' : 'imports';
  return (
    `${match.specifier} · ${match.name} [${match.kind}] ${inArea.files} ${fileWord}, ${inArea.imports} ${importWord} in this area ` +
    `(files by distance: ${distances}); globally ${match.packages} ${packageWord}, ${match.imports} ${globalImportWord} — ${said}`
  );
}

/** One exported match: the name, who holds it, and the file and line to open. */
function exportedLine(match: ExportedMatch): string {
  const rest = match.files - 1;
  const more = rest === 0 ? '' : ` (+${rest} more ${rest === 1 ? 'file' : 'files'})`;
  return `${match.name} — ${match.package ?? 'the repository'} · ${match.at}:${match.line}${more}`;
}

const matchLine = (match: PublishedMatch | ExportedMatch): string =>
  match.source === 'published' ? publishedLine(match) : exportedLine(match);

/*
 * The loose pass — names the words reach when they are allowed apart and
 * allowed one character off — is `looseNames` in `loose.ts`, and what it
 * found is the `loose` section of the answer `search-answer.ts` builds.
 */

const encoded = new WeakMap<Help, SearchIndex>();

/**
 * The search index one Help value encodes to, for callers that hold the value
 * itself rather than the file published beside it. Encoded once per value.
 */
export function searchIndexOf(help: Help): SearchIndex {
  let index = encoded.get(help);
  if (index === undefined) encoded.set(help, (index = openSearchIndex(encodeSearchIndex(help))));
  return index;
}

/** The search over an opened index — what `docs_search` answers, without the Help value. */
export function answerSearch(index: SearchIndex, input: Readonly<Record<string, unknown>>, tree?: Tree): string {
  const question = { query: stringArg(input, 'query'), from: startPointArg(input, 'from'), to: startPointArg(input, 'to') };
  const { answer, area } = searched(index, question, tree);
  const { query } = answer;
  if (area?.refused !== undefined) return areaLine(area);

  const found = answer.published ?? { total: 0, shown: [] };
  const rest = answer.exported ?? { total: 0, shown: [] };
  const looser = answer.loose?.total ?? 0;
  const seenLoosely = (answer.loose?.shown ?? []).map(matchLine);
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

  if (found.total === 0 && rest.total === 0) {
    const nowhere =
      area === undefined
        ? `Nothing in this repository is named or documented with \`${query}\`. \`packages\` lists every entrypoint; \`entrypoint\` lists what one opens.`
        : `Nothing in reach of that start point is named or documented with \`${query}\`. That is a fact about the area, not about the word — ask again without \`from\`/\`to\` to search the whole workspace.`;
    return [...where, nowhere, ...looseSection].join('\n');
  }

  // A capped list that does not say it was capped reads as the whole answer,
  // and the reader's next move — narrow, or ask the entrypoint — depends on
  // knowing which of the two it got.
  const more = found.total > found.shown.length ? [`\n${found.total - found.shown.length} more matches not shown.`] : [];

  const heads =
    found.total === 0
      ? [`Nothing published matches \`${query}\`.`]
      : [
          `${found.total} published ${found.total === 1 ? 'match' : 'matches'} for \`${query}\``,
          '',
          ...found.shown.map(publishedLine),
          ...more,
        ];

  if (rest.total === 0) return [...where, ...heads, ...looseSection].join('\n');

  const hidden = rest.total > rest.shown.length ? [`\n${rest.total - rest.shown.length} more not shown.`] : [];

  return [
    ...where,
    ...heads,
    '',
    `${rest.total} more ${rest.total === 1 ? 'name is' : 'names are'} exported ${area === undefined ? 'somewhere in the repository' : 'in that area'} without being published:`,
    '',
    ...rest.shown.map(exportedLine),
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
