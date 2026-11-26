import type { Tool } from '@variance-authority/mcp/tools';
import type { Page, Spelling } from '@variance-authority/mcp/tools';
import { nextPage, pageAt, pageOf, paged, shellWord, spellingOf } from '@variance-authority/mcp/tools';
import type { Documented, Help } from '@variance-authority/package/help';
import { REACHING, UNFOLLOWED, counted, countsByPath, unfollowedEntry } from './by-path.js';
import { NOTHING_PUBLISHED, specifierOf } from './find.js';
import { mostUsed, narrower, openingRow, plural, section } from './format.js';

/** Rows of each list shown when `limit` is not said: the first page answers where to start, and the rest are counted. */
const SHOWN = 20;

/**
 * `docs_packages` — what each package in this workspace is imported for, counted.
 *
 * Each row is a package or a specifier, because that is what every other tool
 * here takes: a package with four entrypoints is four different imports, and a
 * list of package names would leave three of them to be guessed.
 *
 * It counts, and lists no import. `docs_entrypoint` asked by a package counts
 * the sites behind its count per file, and asked by one of those files'
 * specifiers counts them per name; `docs_uses` lists the sites of one name.
 * The first is printed with its argument. In a
 * repository whose packages declare no entry, every import between packages is
 * by path, and listing them all is the whole import graph.
 *
 * Every list is a page: one `offset` skips the first rows of each list alike,
 * `limit` rows follow in each, and a list cut short ends with how many rows it
 * left and the `offset` that shows the next.
 */
export const packages: Tool<Help> = {
  name: 'docs_packages',
  description:
    'What each package in this workspace is imported for, counted. Call this first: the specifiers it ' +
    'returns are the arguments every other tool here takes. A package that publishes an entry ' +
    'has a row per import specifier it opens, with how many names it opens, how many of those anything ' +
    'imports and how many carry documentation. A package that declares no entry has a row with how many ' +
    'of its names and files other packages import by path. Imports that reach past a published ' +
    'entrypoint are counted per package. Every row names the argument of docs_entrypoint, which counts ' +
    'the import sites behind the counts per file.',
  inputSchema: {
    type: 'object',
    properties: {
      limit: { type: 'integer', description: `Rows to show in each list. ${SHOWN} when not said; the rest are counted.` },
      offset: {
        type: 'integer',
        minimum: 0,
        description: 'Rows to skip at the top of each list before the first shown; a list with more names the next. 0 when not said.',
      },
    },
    additionalProperties: false,
  },

  run(help, input, invocation) {
    const spell = spellingOf(invocation);
    const page = pageOf(input, SHOWN, spell);
    const rows = (all: readonly string[]): readonly string[] => listed(all, page, spell);
    const lines: string[] =
      help.packages.length === 0 ? [`${NOTHING_PUBLISHED.charAt(0).toUpperCase()}${NOTHING_PUBLISHED.slice(1)}.`] : [];
    const opened = help.packages.flatMap((published) => published.openings.map((held) => [published, held] as const));
    lines.push(...rows(opened.map(([published, held]) => openingRow(published, held))));

    // A package that declares no entry opens nothing to list. What other
    // packages import from it is its surface, and nothing else is.
    const counts = countsByPath(help);
    if (counts.unentered.length > 0) {
      section(
        lines,
        `${plural(counts.unentered.length, 'package that declares no entry is', 'packages that declare no entry are')} ` +
          'imported by path, most names first:',
        ...rows(counts.unentered.map(([owner, surface]) => `  ${owner} — ${counted(surface)}`)),
      );
    }
    if (counts.deep.length > 0) {
      const reaching = counts.deep.reduce((sum, [, imports]) => sum + imports, 0);
      section(
        lines,
        `${plural(reaching, 'import reaches', 'imports reach')} past a published entrypoint. ${REACHING}:`,
        ...rows(counts.deep.map(([owner, imports]) => `  ${owner} — ${plural(imports, 'import')}`)),
      );
    }
    // An entry this reading could not follow opens nothing, so the package has
    // no row above. An import that names such an entry is counted here, and one
    // past every entry the package declares is counted with the deep ones.
    const unfollowed = help.packages.filter(unfollowedEntry);
    const naming = counts.unfollowed.reduce((sum, [, imports]) => sum + imports, 0);
    if (unfollowed.length > 0 || naming > 0) {
      const packaged =
        unfollowed.length === 0
          ? []
          : [
              `${plural(unfollowed.length, 'package declares', 'packages declare')} an entry ${UNFOLLOWED}, so none of ` +
                `${unfollowed.length === 1 ? 'its' : 'their'} names are listed.`,
            ];
      const imported =
        naming === 0
          ? []
          : [`${plural(naming, 'import names', 'imports name')} ${unfollowed.length === 0 ? `an entry ${UNFOLLOWED}` : 'an entry like that'}, most first:`];
      section(
        lines,
        [...packaged, ...imported].join(' '),
        ...rows(counts.unfollowed.map(([owner, imports]) => `  ${owner} — ${plural(imports, 'import')}`)),
      );
    }

    // A file that could not be read makes a live name look dead, and a name that
    // looks dead is a name somebody deletes. Saying so beats ranking on it silently.
    if (help.unreadable.length > 0) {
      section(
        lines,
        `${plural(help.unreadable.length, 'file')} could not be read, so the usage counts above are floors:`,
        ...rows(help.unreadable.map((at) => `  ${at}`)),
      );
    }

    const door = mostUsed(opened);
    const doors = [
      ...(door === undefined ? [] : [specifierOf(...door)]),
      ...[counts.unentered[0]?.[0], counts.deep[0]?.[0], mostReached(unfollowed, counts.deep)].filter((owner) => owner !== undefined),
    ];
    const asks = [...new Set(doors)].map((asked) => `variance ask entrypoint --package ${shellWord(asked)}`);
    return [...lines, ...narrower(asks)].join('\n');
  },
};

/** One list's page: which of its rows it shows when it does not start at the first, those rows, and the offset of the next page; nothing for a list with no rows. */
function listed(all: readonly string[], page: Page, spell: Spelling): readonly string[] {
  if (all.length === 0) return [];
  return [...pageAt(page, all.length, spell), ...paged(all, page), ...nextPage(page, all.length, spell)];
}

/**
 * Of the packages whose entry this reading could not follow, the one with the
 * most imports past it, in the order `deep` counts them. None when no import
 * reaches past any of them.
 */
function mostReached(unfollowed: readonly Documented[], deep: readonly (readonly [string, number])[]): string | undefined {
  const names = new Set(unfollowed.map((published) => published.name));
  return deep.find(([owner]) => names.has(owner))?.[0];
}
