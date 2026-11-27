import { formatCandidateMap } from './search-map-format.js';
import type { FileSet, Spelling, Tool, ToolInvocation, Tree } from '@variance-authority/mcp/tools';
import { limitOf, notShownPast, START_POINT_SCHEMA, saysStartPoint, spellingOf, startPointArg, stringArg } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import type { SearchIndex } from '../search-index.js';
import { areaLine } from './area.js';
import { describedLine, thirdLine, thirdScope } from './third-party.js';
import type { Matches, Searched, SearchQuestion } from './search-matches.js';
import { aliasLine, declaredLine, heldLine, unreadLine } from './declared.js';
import { casesUnder, describedRow, exportedLine, isPublished, matchLine, publishedLine, testLine } from './search-rows.js';
import { unreadStop } from './members.js';
import { CAP, ELSEWHERE_CAP, LOOSE_CAP, NEAR_CAP, searched } from './search-answer.js';
import { LEXICON_INSTALLED_CAP } from '../dependency-lexicon.js';
import type { ImportingOf } from './published-match.js';
import type { DeclarationLookups } from './exported-matches.js';
import { NAMED, named } from './format.js';
import { orient } from './orient.js';
import { symbol } from './symbol.js';
import { searchReading, renderedFiles } from './search-reading.js';

/**
 * `docs_search` — the name for a thing somebody can only describe.
 *
 * Substring, case-insensitive, over the name and over what was written about
 * it; and several words, over the words a name is written in, each word
 * matching one that starts with it or shares its stem. A match there is a fact
 * about the text, so it is reported first, ordered first by where it
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

/*
 * The loose pass — names the words reach when they are allowed apart and
 * allowed one character off — is `looseNames` in `loose.ts` for the names a
 * row holds and `looseDeclarations` in `loose-declared.ts` for the ones a file
 * keeps to itself, and what they found is the `loose` section of the answer
 * `search-answer.ts` builds.
 */

/**
 * The question `search` is asked by `input`, as its schema accepted it; a
 * `limit` that is no whole number of rows is refused as `spell` names it.
 */
export function searchQuestionOf(input: Readonly<Record<string, unknown>>, spell: Spelling = spellingOf(undefined)): SearchQuestion {
  const question = { query: stringArg(input, 'query'), from: startPointArg(input, 'from'), to: startPointArg(input, 'to'), ...(input['map'] === undefined ? {} : { map: stringArg(input, 'map') }) };
  // Absent rather than a default, so a question that says none asks, caches and answers as it did before `limit`.
  return input['limit'] === undefined ? question : { ...question, limit: limitOf(input, 0, spell) };
}

/** The search over an opened index — what `docs_search` answers, without the Help value; `spell` names `limit` in its cuts. */
export function answerSearch(
  index: SearchIndex,
  input: Readonly<Record<string, unknown>>,
  tree?: Tree,
  root?: string,
  importing?: ImportingOf,
  spell: Spelling = spellingOf(undefined),
  declarations?: DeclarationLookups,
): string {
  const question = searchQuestionOf(input, spell);
  return spoken(searched(index, question, tree, root, importing, declarations), question, root, spell);
}

/** The line a list cut at what it shows ends with, set apart from its rows; nothing when it shows all `total`. */
function cut(total: number, shown: number, spell: Spelling): readonly string[] {
  return notShownPast(total, shown, spell).map((line) => `\n${line}`);
}

/** A list under its head, cut at what `found` shows and saying so; nothing when it holds none. */
function section<Row>(head: string, found: Matches<Row>, line: (row: Row) => string, spell: Spelling): readonly string[] {
  if (found.total === 0) return [];
  return ['', head, '', ...found.shown.map(line), ...cut(found.total, found.shown.length, spell)];
}

/**
 * The question that lists `total` rows of a section in full: `asked` again,
 * with a `limit` that shows them all, spelled as the asker asks. A `limit`
 * caps every list, so it is never below the widest cap: the question only
 * widens the answer, and no list of the repository's own shows fewer rows.
 */
function inFull(asked: SearchQuestion, total: number, spell: Spelling): string {
  const where = { ...(asked.from === undefined ? {} : { from: asked.from }), ...(asked.to === undefined ? {} : { to: asked.to }) };
  return `${spell.question(search, { query: asked.query, ...where, limit: Math.max(total, CAP) })} lists all matching names.`;
}

/** What a search says of what it found, to `asked`. */
function spoken({ answer, area }: Searched, asked: SearchQuestion, root: string | undefined, spell: Spelling): string {
  const { query } = answer;
  if (answer.candidateMap !== undefined) return formatCandidateMap(answer.candidateMap, (map) => spell.question(search, { query: asked.query, ...(asked.from === undefined ? {} : { from: asked.from }), ...(asked.to === undefined ? {} : { to: asked.to }), map }));
  if (area?.refused !== undefined) return areaLine(area);

  const found = answer.published ?? { total: 0, shown: [] };
  const rest = answer.exported ?? { total: 0, shown: [] };
  const looser = answer.loose?.total ?? 0;
  const third = answer.thirdParty;
  const lexicon = root !== undefined && third === undefined ? ['', 'Dependency lexicon not published; run `variance index` to prepare it.'] : [];
  // Said once, as `uses` says it, below the rows it leaves short.
  const unreadImports = answer.importsUnread === undefined ? [] : ['', `Imports that do not name a package path are not counted: ${answer.importsUnread}.`];
  const missing = [...unreadImports, ...lexicon];
  // The repository's own rows are the answer whenever there are any: then
  // installed and describing packages stay compact, with names limited by the request.
  const ownFound = [answer.published, answer.exported, answer.declared, answer.held, answer.tests, answer.aliases, answer.described, answer.loose].some(
    (list) => (list?.total ?? 0) > 0,
  );
  const compact = ownFound;
  const thirdHead = (total: number): string => `${total} third-party ${total === 1 ? 'name matches' : 'names match'} \`${query}\``;
  const thirdSection = third === undefined
    ? []
    : third.total === 0
    ? ownFound ? [] : ['', `No third-party name matches \`${query}\`. ${thirdScope(third.scope)}`]
    : compact
    ? named(thirdHead(third.total), third.shown.map((match) => `${match.specifier} · ${match.name}`), third.total, inFull(asked, third.total, spell), asked.limit)
    : [
    '',
    `${thirdHead(third.total)}, ` +
      (area === undefined ? 'offered by some manifest in this workspace:' : 'usable from that start point, under the manifest that owns it:'),
    '',
    ...third.shown.map(thirdLine),
    ...cut(third.total, third.shown.length, spell),
  ];
  const described = third?.described ?? [];
  const describing = third?.describedTotal ?? described.length;
  const describedHead = `${describing} ${describing === 1 ? 'package describes' : 'packages describe'} \`${query}\``;
  const describedSection =
    third?.describedUnread !== undefined
      ? ['', `${third.describedUnread}, so no package was asked whether it describes \`${query}\`; \`variance index\` rebuilds it.`]
      : described.length === 0
      ? []
      : compact
      ? named(describedHead, described.map((hit) => hit.specifier), describing, inFull(asked, describing, spell), asked.limit)
      : [
          '',
          `${describedHead} in their own words or the words of their names, best first:`,
          '',
          ...described.map(describedLine),
          ...cut(third?.describedTotal ?? 0, described.length, spell),
        ];
  const seenLoosely = (answer.loose?.shown ?? []).map(matchLine);
  const looseSection =
    looser === 0
      ? []
      : [
          '',
          `${looser} more ${looser === 1 ? 'name matches' : 'names match'} loosely, the words apart or a character off:`,
          '',
          ...seenLoosely,
          ...cut(looser, seenLoosely.length, spell),
        ];
  const held = answer.described ?? { total: 0, shown: [] };
  const heldSection =
    held.total === 0
      ? []
      : [
          '',
          `Near matches, not exact: ${held.total} ${held.total === 1 ? 'holds' : 'hold'} most of \`${query}\`:`,
          '',
          ...held.shown.map(describedRow),
          ...cut(held.total, held.shown.length, spell),
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
  const place = area === undefined ? 'somewhere in the repository' : 'in that area';
  const declared = answer.declared ?? { total: 0, shown: [], unread: [] };
  const stop = unreadStop(answer.membersUnread ?? []);
  const unread = [...unreadLine(declared.unread), ...(stop === undefined ? [] : [stop])].map((line) => `\n${line}`);
  const inside = answer.held ?? { total: 0, shown: [] };
  const insideSection = section(`${inside.total} ${inside.total === 1 ? 'name is' : 'names are'} held by a container or a function ${place}:`, inside, heldLine, spell);
  const aliases = answer.aliases ?? { total: 0, shown: [] };
  const aliasSection = section(`${aliases.total} ${aliases.total === 1 ? 'import binds' : 'imports bind'} it as a local name:`, aliases, aliasLine, spell);
  const namesSection = [...section(`${declared.total} more ${declared.total === 1 ? 'name is' : 'names are'} declared ${place} without being exported:`, declared, declaredLine, spell), ...unread];
  const tests = answer.tests ?? { total: 0, shown: [] };
  const testSection = section(`${tests.total} recorded test ${tests.total === 1 ? 'case holds' : 'cases hold'} every word, as the last run wrote it:`, tests, testLine, spell);
  const declaredSection = [...namesSection, ...insideSection, ...testSection, ...casesUnder(answer.tests, ownFound), ...aliasSection];

  // Last, so the answer ends on what to run, about its first declaration in
  // the order shown, and a recorded case only when no declaration answered: a
  // case says where the code was tested, not where it is. A published row is
  // asked by its specifier, any other by what surrounds its file, each spelled
  // as the asker asks; nothing when the repository answered with no row.
  const lead = [found, rest, declared, inside, aliases, held, answer.loose, tests]
    .map((list): { readonly at: string } | undefined => list?.shown[0])
    .find((row) => row !== undefined);
  const next = lead === undefined
    ? []
    : isPublished(lead)
      ? ['', `Next: ${spell.question(symbol, { name: lead.name, package: lead.specifier })}`]
      : ['', `Next: ${spell.question(orient, { files: [lead.at] })}`];

  if (found.total === 0 && rest.total === 0 && declared.total === 0 && inside.total === 0 && tests.total === 0 && aliases.total === 0 && (third?.total ?? 0) === 0) {
    // It names what the substring read, and no more: a local that is no function
    // is in no index, a closure's doc is its holder's, and the doc a file opens
    // with is read only for the words, so a file may still write the phrase.
    const reach = area === undefined ? 'in this repository' : 'in reach of that start point';
    const read = answer.declared === undefined
      ? `No export ${reach}, nor the doc of one, writes \`${query}\`; ${unreadLine(undefined).join(' ')}`
      : `No export, top-level declaration or member of a class, an interface or a type ${reach}, nor the doc of one, nor a function inside a function, writes \`${query}\``;
    // A miss of the text is not a miss of the code: with names to offer, the line
    // says only that the text was not written. Inside an area the text may be
    // written outside it, so the way to widen stays.
    const nowhere =
      own.length > 0
        ? area === undefined
          ? `${read}. The nearest follow.`
          : `${read} — ask again without \`from\`/\`to\` to search the whole workspace. The nearest in reach follow.`
        : area === undefined
        ? `${read}. \`packages\` lists every entrypoint; \`entrypoint\` lists what one opens.`
        : `${read}. That is a fact about the area, not about the word — ask again without \`from\`/\`to\` to search the whole workspace.`;
    return [...where, nowhere, ...declaredSection, ...own, ...thirdSection, ...describedSection, ...missing, ...next].join('\n');
  }

  // A capped list that does not say it was capped reads as the whole answer,
  // and the reader's next move — narrow, or ask the entrypoint — depends on
  // knowing which of the two it got.
  const more = cut(found.total, found.shown.length, spell);

  const heads =
    found.total === 0
      ? []
      : [
          `${found.total} published ${found.total === 1 ? 'match' : 'matches'} for \`${query}\``,
          '',
          ...found.shown.map(publishedLine),
          ...more,
        ];

  if (rest.total === 0) return [...where, ...(found.total === 0 ? [] : heads), ...declaredSection, ...own, ...thirdSection, ...describedSection, ...missing, ...next].join('\n');

  const hidden = cut(rest.total, rest.shown.length, spell);

  return [
    ...where,
    ...heads,
    ...(found.total === 0 ? [] : ['']),
    found.total === 0
      ? `${rest.total} exported ${rest.total === 1 ? 'match' : 'matches'} for \`${query}\` (not published):`
      : `${rest.total} more ${rest.total === 1 ? 'name is' : 'names are'} exported ${area === undefined ? 'somewhere in the repository' : 'in that area'} without being published:`,
    '',
    ...rest.shown.map(exportedLine),
    ...hidden,
    ...declaredSection,
    ...own,
    ...thirdSection,
    ...describedSection,
    ...missing,
    ...next,
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
    'Find candidate names by words, when you do not know the exact name. A name matches when its name ' +
    'or documentation contains your text, case-insensitive, or its words share the stem of every word ' +
    'you typed: published names, with the specifier for docs_symbol, then unpublished and file-local ' +
    'names, recorded test cases, installed names and packages, and near matches. Words only, no synonyms: `auth` does ' +
    'not find `CredentialGate`, so when nothing matches, ask another candidate word, not a longer ' +
    'phrase. A word under three letters has no stem but still counts as written: `node id` finds ' +
    '`NodeId`. On a large repository give `from` or `to`; an empty answer there is a fact about that ' +
    'area. A list holds candidates, not every match: `git grep -i <word>` prints every line.',
  inputSchema: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'A substring, or a few words of what the name does. Ask each candidate word as its own query.',
      },
      map: { type: 'string', description: 'Optional. `root` maps every candidate file by code-map area and dependency layer; an emitted drill id opens that exact group. Detailed name limits do not cap this map.' },
      from: START_POINT_SCHEMA.from,
      to: {
        ...START_POINT_SCHEMA.to,
        description:
          `${START_POINT_SCHEMA.to.description} For dependents of what you hold: \`to\` the helper, \`query\` a word around it.`,
      },
      limit: {
        type: 'integer',
        description: `Optional. Rows per list, the rest counted. When not said: ${CAP} published, ${NEAR_CAP} near, ${LOOSE_CAP} loose, ${ELSEWHERE_CAP} of each other own kind; installed and describing packages ${NAMED} beside own rows, ${LEXICON_INSTALLED_CAP} with none.`,
      },
    },
    required: ['query'],
    additionalProperties: false,
  },

  // The tree is a walk of the repository, so it is read when a question names a
  // path and never on the way past.
  wants: saysStartPoint,

  run: (help, input, invocation) =>
    spoken(searchReading(help, searchQuestionOf(input, spellingOf(invocation)), invocation).read(), searchQuestionOf(input, spellingOf(invocation)), invocation?.root, spellingOf(invocation)),

  // The file set is the files that matched, every file exporting a name, and
  // walks no declaration: one outside an area is the row's to name, not the set's.
  files: (help, input, invocation): FileSet =>
    searchReading(help, searchQuestionOf(input, spellingOf(invocation)), invocation).membership(),
};

/**
 * The files of the rows `run` prints, and the entries and barrels that make a
 * row published, which the count of that row walked already. `search.files` is
 * every match, a set another question crosses; a row past the cap is no part of
 * this answer, so the count printed above the rows stays the generation's. A
 * recorded case is none of them: it rests on the last run, not the generation,
 * so a test file gone since then says nothing about the generation's age.
 */
export function printedFiles(help: Help, input: Readonly<Record<string, unknown>>, invocation?: ToolInvocation<Help>): ReadonlySet<string> {
  return renderedFiles(help, searchQuestionOf(input, spellingOf(invocation)), invocation);
}
