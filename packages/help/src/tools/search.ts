import type { Tool } from '@variance-authority/mcp/tools';
import { START_POINT_SCHEMA, startPointArg, stringArg } from '@variance-authority/mcp/tools';
import type { Entry, Help, Named } from '@variance-authority/package/help';
import { everyEntry } from '@variance-authority/package/help';
import { areaLine, areaOf } from './area.js';
import { specifierOf } from './find.js';
import { line } from './format.js';

/**
 * `docs_search` — the name for a thing somebody can only describe.
 *
 * Substring, case-insensitive, over the name and over what was written about it.
 * Not fuzzy and not embedded: a match here is a fact about the text, so a caller
 * that gets nothing back has learned something true rather than that the ranking
 * disagreed with them.
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
 * ## Where the substring stops being enough
 *
 * On a repository of a few thousand names it is. On a large one it is not, and
 * no ranking fixes that: `order` really is written into four hundred names, the
 * reader wanted the nine in one service, and the text cannot tell those apart
 * because the text is the same. What separates them is a fact the caller holds
 * and the query never carried — which part of the repository they are standing
 * in — so `from` and `to` take it as a path and the closure decides what may be
 * answered. See [`area.ts`](./area.ts): a boundary, not a preference.
 */

/** Published matches shown before the answer says it stopped. */
const CAP = 40;

/** Exported matches shown. Lower, because the section below it is the cheaper half. */
const ELSEWHERE_CAP = 25;

function matches(entry: Entry, query: string): boolean {
  return entry.name.toLowerCase().includes(query) || (entry.doc ?? '').toLowerCase().includes(query);
}

/**
 * Exported names matching the query, one line each, nearest thing to a ranking.
 *
 * Grouped by name because one name exported from a barrel and from the file that
 * declares it is one thing to go and look at, and ordered by how many files
 * export it — which is the only count this half has. Source before tests and
 * stories within a name, so the place shown first is the implementation rather
 * than something exercising it.
 */
function elsewhere(
  help: Help,
  query: string,
  published: ReadonlySet<string>,
  within: ReadonlySet<string> | undefined,
): readonly string[] {
  const found = new Map<string, Named[]>();

  for (const name of help.exported) {
    if (published.has(name.name) || !name.name.toLowerCase().includes(query)) continue;
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

export const search: Tool<Help> = {
  name: 'docs_search',
  description:
    'Find names whose name or documentation contains a string, case-insensitive. Published names ' +
    'come first, ordered by how many packages import them, each carrying the import specifier it ' +
    'is published from so it can be passed straight to docs_symbol. Names the repository exports ' +
    'but does not publish follow, with the file and line that exports them. On a large ' +
    'repository a substring alone matches everywhere a product says its own name, so say where ' +
    'you are standing: `from` a path answers only from the files that path reaches along the ' +
    'imports, `to` a path only from the files that reach it. That removes names rather than ' +
    'ranking them down, so an empty answer is a fact about the area.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Substring to look for in names and docs.' },
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

    const found = [...everyEntry(help)]
      .filter(([, , entry]) => matches(entry, query))
      .filter(([, , entry]) => within === undefined || within.has(entry.at))
      .sort(
        ([, , a], [, , b]) =>
          b.usedBy.length - a.usedBy.length ||
          b.uses - a.uses ||
          (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
      );

    const rest = elsewhere(help, query, new Set(found.map(([, , entry]) => entry.name)), within);

    // Said before the counts and before the emptiness, because it is what the
    // counts are counts *of*. A reader told `nothing matches` without being told
    // where the tool looked has been handed a fact they cannot place.
    const where = area === undefined ? [] : [areaLine(area), ''];

    if (found.length === 0 && rest.length === 0) {
      const nowhere =
        area === undefined
          ? `Nothing in this repository is named or documented with \`${query}\`. \`packages\` lists every entrypoint; \`entrypoint\` lists what one opens.`
          : `Nothing in reach of that start point is named or documented with \`${query}\`. That is a fact about the area, not about the word — ask again without \`from\`/\`to\` to search the whole workspace.`;
      return [...where, nowhere].join('\n');
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
            ...shown.map(([owner, held, entry]) => `${specifierOf(owner, held)} · ${line(entry)}`),
            ...more,
          ];

    if (rest.length === 0) return [...where, ...heads].join('\n');

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
    ].join('\n');
  },
};
