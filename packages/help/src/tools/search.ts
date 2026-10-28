import type { FileSet, Tool, Tree } from '@variance-authority/mcp/tools';
import { START_POINT_SCHEMA, startPointArg, stringArg } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import type { SearchIndex } from '../search-index.js';
import { encodeSearchIndex, openSearchIndex } from '../search-index.js';
import { areaLine } from './area.js';
import { describedLine, thirdLine, thirdScope } from './third-party.js';
import type { DeclaredMatch, DescribedMatch, ExportedMatch, FileMatch, PublishedMatch } from './search-answer.js';
import { declaredLine, unreadLine } from './declared.js';
import { searched, searchedFiles } from './search-answer.js';
import { withImporting } from './published-match.js';
import { type ImportingOf, importingOf } from './uses-count.js';
import { byPublishedPath, plural } from './format.js';

/**
 * `docs_search` — the name for a thing somebody can only describe.
 *
 * Substring, case-insensitive, over the name and over what was written about
 * it; and several words, over the words a name is written in, each word
 * matching one that starts with it or shares its stem. A match there is a fact
 * about the text, so it is reported first and whole, ordered first by where it
 * was found — the whole name, as written and then in another case, part of the
 * name, the doc's opening paragraph, the rest of the doc — and then by who
 * imports it: a name that is the word is what was asked for, a name holding it
 * is that thing, and a doc saying it three paragraphs down only mentions it.
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
 * clean, and the line above what it appends still says the substring matched
 * nothing — as a miss of the text typed, since *nothing* over a list of names
 * would read as a miss of the code.
 *
 * The order inside it is the order the sections above use, by consumers and
 * then by name. The index decides membership; it is never allowed to decide
 * position, because a caller who can see why a name is in a list can check it,
 * and a caller reading a rank has to trust it.
 *
 * ## A description, stemmed the way a package's is
 *
 * An agent that cannot name the thing describes it, and a description holds
 * words the name does not: `which tests entered a file`. Beside the loose pass
 * runs the reading the installed packages already get — the question cut into
 * stems, stopwords dropped — with one difference: a package answers when it
 * holds half of them, and the repository's own name when it holds any. So the
 * repository's own names answer before any package that says the same
 * words, and a name holding one word of three is answered rather than reported
 * as nothing. A file answers beside them, by its own name and the doc it opens with,
 * since what a file is for is said once at its top and by no one declaration
 * in it. Its order is counts, written next to each row as the words it holds:
 * a caller can check `[holds: file, tests]`, and could not check a score.
 * Between two that hold as many, the one whose name holds more of them comes
 * first, then the one whose doc writes more of the question's adjacent word
 * pairs adjacent. Every word one of them holds is held by a row shown, so a name
 * holding the one rare word is shown however many holding a common one sort
 * before it. It prints first, so a name holding at least half the stems
 * is not offered again by the loose pass. A name holding fewer is the loose
 * pass's when that pass reaches it, by every word, so on three words or more a
 * long list of names holding one stem cannot sort it past the rows shown.
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

/**
 * Who imports a published match, each count saying what it counts: the places
 * and the packages they sit in, as `uses` counts them; or, given without the
 * Help value, the imports from other packages by a published specifier.
 */
function importedLine(match: PublishedMatch): string {
  const { importedIn } = match;
  if (importedIn !== undefined) {
    return importedIn.places === 0 ? 'imported nowhere' : `imported in ${plural(importedIn.places, 'place')} in ${plural(importedIn.packages, 'package')}`;
  }
  return byPublishedPath(match.otherImports, match.otherPackages);
}

/** One published match: where it is published, what it is, who imports it, and what its doc says first. */
function publishedLine(match: PublishedMatch): string {
  const { inArea } = match;
  const said = match.summary ?? 'UNDOCUMENTED';
  if (inArea === undefined) return `${match.specifier} · ${match.name} [${match.kind}] ${importedLine(match)} — ${said}`;
  const distances = inArea.filesByDistance.map(([at, files]) => `${at}: ${files}`).join(', ');
  return (
    `${match.specifier} · ${match.name} [${match.kind}] ${plural(inArea.files, 'file')}, ${plural(inArea.imports, 'import')} in this area ` +
    `(files by distance: ${distances}); across the repository ${importedLine(match)} — ${said}`
  );
}

/** One exported match: the name, who holds it, and the file and line to open. */
function exportedLine(match: ExportedMatch): string {
  const rest = match.files - 1;
  const more = rest === 0 ? '' : ` (+${rest} more ${rest === 1 ? 'file' : 'files'})`;
  const said = match.summary === undefined ? '' : ` — ${match.summary}`;
  return `${match.name} — ${match.package ?? 'the repository'} · ${match.at}:${match.line}${more}${said}`;
}

/** One described file: the path, who holds it, and what the doc it opens with says first. */
function fileLine(match: FileMatch): string {
  return `${match.at} [file] — ${match.package ?? 'the repository'}${match.summary === undefined ? '' : ` — ${match.summary}`}`;
}

const matchLine = (match: PublishedMatch | ExportedMatch | DeclaredMatch): string =>
  match.source === 'published' ? publishedLine(match) : match.source === 'exported' ? exportedLine(match) : declaredLine(match);

const describedRow = (match: DescribedMatch): string =>
  `${match.source === 'file' ? fileLine(match) : matchLine(match)} [holds: ${match.words.join(', ')}]`;

/*
 * The loose pass — names the words reach when they are allowed apart and
 * allowed one character off — is `looseNames` in `loose.ts` for the names a
 * row holds and `looseDeclarations` in `loose-declared.ts` for the ones a file
 * keeps to itself, and what they found is the `loose` section of the answer
 * `search-answer.ts` builds.
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
export function answerSearch(index: SearchIndex, input: Readonly<Record<string, unknown>>, tree?: Tree, root?: string, importing?: ImportingOf): string {
  const question = { query: stringArg(input, 'query'), from: startPointArg(input, 'from'), to: startPointArg(input, 'to') };
  const searchedOnce = searched(index, question, tree, root);
  const { area } = searchedOnce;
  const answer = withImporting(searchedOnce.answer, importing);
  const { query } = answer;
  if (area?.refused !== undefined) return areaLine(area);

  const found = answer.published ?? { total: 0, shown: [] };
  const rest = answer.exported ?? { total: 0, shown: [] };
  const looser = answer.loose?.total ?? 0;
  const third = answer.thirdParty;
  const lexicon = root !== undefined && third === undefined ? ['', 'Dependency lexicon not published; run `variance index` to prepare it.'] : [];
  // Said once, as `uses` says it, below the rows it leaves short.
  const unreadImports = answer.importsUnread === undefined ? [] : ['', `Imports that do not name a package path are not counted: ${answer.importsUnread}.`];
  const missing = [...unreadImports, ...lexicon];
  const thirdSection = third === undefined ? [] : third.total === 0 ? ['', `No third-party name matches \`${query}\`. ${thirdScope(third.scope)}`] : [
    '',
    `${third.total} third-party ${third.total === 1 ? 'name' : 'names'} match \`${query}\`, ` +
      (area === undefined ? 'offered by some manifest in this workspace:' : 'usable from that start point, under the manifest that owns it:'),
    '',
    ...third.shown.map(thirdLine),
    ...(third.total > third.shown.length ? [`\n${third.total - third.shown.length} more not shown.`] : []),
  ];
  const described = third?.described ?? [];
  const describedSection =
    third?.describedUnread !== undefined
      ? ['', `${third.describedUnread}, so no package was asked whether it describes \`${query}\`; \`variance index\` rebuilds it.`]
      : described.length === 0
      ? []
      : [
          '',
          `${third?.describedTotal ?? described.length} ${(third?.describedTotal ?? described.length) === 1 ? 'package describes' : 'packages describe'} \`${query}\` in ` +
            'their own words or the words of their names, best first:',
          '',
          ...described.map(describedLine),
          ...((third?.describedTotal ?? 0) > described.length ? [`\n${(third?.describedTotal ?? 0) - described.length} more not shown.`] : []),
        ];
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
  const held = answer.described ?? { total: 0, shown: [] };
  const heldSection =
    held.total === 0
      ? []
      : [
          '',
          `${held.total} ${held.total === 1 ? 'name or file in this repository holds' : 'names and files in this repository hold'} words of \`${query}\`, ` +
            'read by stem as the packages are, best first: the words held, each counted by how few of these hold it and more in the name than in a doc, then the words in the name, then the phrase its doc writes; a row holding each word is shown however it sorts.',
          '',
          ...held.shown.map(describedRow),
          ...(held.total > held.shown.length ? [`\n${held.total - held.shown.length} more not shown.`] : []),
        ];
  // This repository's own names before any installed package's: the question
  // was asked of this checkout, and a dependency is the answer only when none
  // of its own names is.
  const own = [...heldSection, ...looseSection];

  // Said before the counts and before the emptiness, because it is what the
  // counts are counts *of*. A reader told `nothing matches` without being told
  // where the tool looked has been handed a fact they cannot place.
  const where = area === undefined ? [] : [areaLine(area), ''];

  // Below the exports, since none of these is a name its file hands out.
  const declared = answer.declared ?? { total: 0, shown: [], unread: [] };
  const unread = unreadLine(declared.unread).map((line) => `\n${line}`);
  const declaredSection =
    declared.total === 0
      ? unread
      : [
          '',
          `${declared.total} more ${declared.total === 1 ? 'name is' : 'names are'} declared ${area === undefined ? 'somewhere in the repository' : 'in that area'} without being exported:`,
          '',
          ...declared.shown.map(declaredLine),
          ...(declared.total > declared.shown.length ? [`\n${declared.total - declared.shown.length} more not shown.`] : []),
          ...unread,
        ];

  if (found.total === 0 && rest.total === 0 && declared.total === 0 && (third?.total ?? 0) === 0) {
    // A miss of the text is not a miss of the code: when this repository's own
    // names answer the words, the line above them says only that the text was
    // not written, so a reader who stops at the first line does not stop at *nothing*.
    // It names what the substring read, names and their docs: the doc a file
    // opens with is read only for the words, so a file may still write the phrase.
    // Inside an area the text may be written outside it, so the way to widen stays.
    const nowhere =
      own.length > 0
        ? area === undefined
          ? `No name in this repository, nor the doc of one, writes \`${query}\` as typed. The nearest follow.`
          : `No name in reach of that start point, nor the doc of one, writes \`${query}\` as typed — ask again without \`from\`/\`to\` to search the whole workspace. The nearest in reach follow.`
        : area === undefined
        ? `Nothing in this repository is named or documented with \`${query}\`. \`packages\` lists every entrypoint; \`entrypoint\` lists what one opens.`
        : `Nothing in reach of that start point is named or documented with \`${query}\`. That is a fact about the area, not about the word — ask again without \`from\`/\`to\` to search the whole workspace.`;
    return [...where, nowhere, ...declaredSection, ...own, ...thirdSection, ...describedSection, ...missing].join('\n');
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

  if (rest.total === 0) return [...where, ...(found.total === 0 ? [] : heads), ...declaredSection, ...own, ...thirdSection, ...describedSection, ...missing].join('\n');

  const hidden = rest.total > rest.shown.length ? [`\n${rest.total - rest.shown.length} more not shown.`] : [];

  return [
    ...where,
    ...heads,
    '',
    `${rest.total} more ${rest.total === 1 ? 'name is' : 'names are'} exported ${area === undefined ? 'somewhere in the repository' : 'in that area'} without being published:`,
    '',
    ...rest.shown.map(exportedLine),
    ...hidden,
    '',
    `From a file above to what surrounds it: \`variance ask orient --files ${rest.shown[0]!.at}\`.`,
    ...declaredSection,
    ...own,
    ...thirdSection,
    ...describedSection,
    ...missing,
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
    'Find names whose name or documentation contains a string, case-insensitive, or whose words ' +
    'start with or share the stem of every word you typed. Published names come first, a name holding ' +
    'your words before a doc opening with them before a doc saying them later, then by how many ' +
    'other packages import them, each labelled with the places that import it and the packages they sit in, ' +
    'counted as docs_uses counts them, and carrying the import specifier it ' +
    'is published from so it can be passed straight to docs_symbol. Names the repository exports ' +
    'but does not publish follow, with the file and line that exports them, then names a file ' +
    'declares at its top level without exporting, by their names or their documentation, with the file and line that declare them. Installed third-party ' +
    'names appear separately when the third-party API catalogue is published, followed by the installed ' +
    'packages that describe your words — in their own description, keywords and README headings, or in ' +
    'the words of their names — so a job reaches a package by what it does. When nothing in this ' +
    'repository holds the query as written, its own names and files holding any of your words, ' +
    'read by stem, come before any installed package, a file by its name and the doc it opens with, best ' +
    'first by the words held, then by the words in the name, then by how much of your phrase its doc writes, ' +
    'each labelled with the words it holds; names that match loosely — your words apart, or within a ' +
    'character of the ones written, exported or kept to their file — follow them. Neither is mixed into the sections above. On a large ' +
    'repository a substring alone matches everywhere a product says its own name, so say where ' +
    'you are standing. Carry a path the editor, ticket or stack trace already supplied: `from` ' +
    'answers with published names imported by the files that path reaches; `to` does the same ' +
    'for files that reach a known dependency. Both traverse the resolved module graph at any ' +
    'depth. Internal exports are filtered by their declaring file; third-party names are limited ' +
    'to packages available to workspaces in that closure. An empty ' +
    'answer is a fact about the area. Names match the words you typed and nothing else — no ' +
    'synonyms, no model — so a repository that calls sign-in `CredentialGate` is not reached by ' +
    '`auth`. Supplying the likely vocabulary is your half: when a query matches nothing, ask again ' +
    'with another candidate word rather than a longer description of the same idea.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description:
          'Substring to look for in names and docs, or a few words of what the name does. A name is ' +
          'matched by the words you type, never by their synonyms, so `auth` finds nothing in a ' +
          'repository that writes `login`, `session` or `credential`. Ask each candidate as its own query.',
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

  run: (help, input, invocation) => answerSearch(searchIndexOf(help), input, invocation?.tree, invocation?.root, importingOf(help, invocation?.root)),

  files: (help, input, invocation): FileSet => ({
    files: searchedFiles(searchIndexOf(help), { query: stringArg(input, 'query'), from: startPointArg(input, 'from'), to: startPointArg(input, 'to') }, invocation?.tree),
  }),
};
