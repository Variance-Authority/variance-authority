import { codeUnitOrder } from '@variance-authority/core/segment';
import type { Tool } from '@variance-authority/mcp/tools';
import { NO_ARGS } from '@variance-authority/mcp/tools';
import type { Documented, Help } from '@variance-authority/package/help';
import { REACHING, counted, countsByPath } from './by-path.js';
import { NOTHING_PUBLISHED, specifierOf } from './find.js';
import { mostUsed, narrower, openingRow, plural, section, shell } from './format.js';

/**
 * `docs_packages` — what each package in this workspace is imported for, counted.
 *
 * Each row is a package or a specifier, because that is what every other tool
 * here takes: a package with four entrypoints is four different imports, and a
 * list of package names would leave three of them to be guessed.
 *
 * It counts, and lists no import. The sites behind a count are what
 * `docs_entrypoint` answers for one package, and that question is printed with
 * its argument: in a repository whose packages declare no entry, every import
 * between packages is by path, and listing them all is the whole import graph.
 */
export const packages: Tool<Help> = {
  name: 'docs_packages',
  description:
    'What each package in this workspace is imported for, counted. A package that publishes an entry ' +
    'has a row per import specifier it opens, with how many names it opens, how many of those anything ' +
    'imports and how many carry documentation. A package that declares no entry has a row with how many ' +
    'of its names and files other packages import by path. Imports that reach past a published ' +
    'entrypoint are counted per package. Every row names the argument of docs_entrypoint, which lists ' +
    'the import sites behind the counts. With nothing in hand, docs_orient with no files prints the ' +
    'package graph folded into areas.',
  inputSchema: NO_ARGS,

  run(help) {
    const lines: string[] =
      help.packages.length === 0 ? [`${NOTHING_PUBLISHED.charAt(0).toUpperCase()}${NOTHING_PUBLISHED.slice(1)}.`] : [];
    const opened = help.packages.flatMap((published) => published.openings.map((held) => [published, held] as const));
    lines.push(...opened.map(([published, held]) => openingRow(published, held)));

    // A package that declares no entry opens nothing to list. What other
    // packages import from it is its surface, and nothing else is.
    const counts = countsByPath(help);
    if (counts.unentered.length > 0) {
      section(
        lines,
        `${plural(counts.unentered.length, 'package declares', 'packages declare')} no entry. Other packages import ` +
          'their files by path, most names first:',
        ...counts.unentered.map(([owner, surface]) => `  ${owner} — ${counted(surface)}`),
      );
    }
    if (counts.deep.length > 0) {
      section(
        lines,
        `${plural(help.deep.length, 'import reaches', 'imports reach')} past a published entrypoint. ${REACHING}:`,
        ...counts.deep.map(([owner, imports]) => `  ${owner} — ${plural(imports, 'import')}`),
      );
    }
    // An entry that leads to no source file opens nothing, so the package has
    // no row above, and every import of it is counted as past its entry.
    const unfollowed = help.packages.filter((published) => published.openings.length === 0 && declaresEntry(published));
    if (unfollowed.length > 0) {
      section(
        lines,
        `${plural(unfollowed.length, 'package declares', 'packages declare')} an entry that leads to no source file, so none of ` +
          `${unfollowed.length === 1 ? 'its' : 'their'} names are listed.`,
      );
    }

    // A file that could not be read makes a live name look dead, and a name that
    // looks dead is a name somebody deletes. Saying so beats ranking on it silently.
    if (help.unreadable.length > 0) {
      section(
        lines,
        `${plural(help.unreadable.length, 'file')} could not be read, so the usage counts above are floors:`,
        ...help.unreadable.map((at) => `  ${at}`),
      );
    }

    const door = mostUsed(opened);
    const doors = [
      ...(door === undefined ? [] : [specifierOf(...door)]),
      ...[counts.unentered[0]?.[0], counts.deep[0]?.[0], mostReached(unfollowed, counts.deep)].filter((owner) => owner !== undefined),
    ];
    const asks = [...new Set(doors)].map((asked) => `variance ask entrypoint --package ${shell(asked)}`);
    return [...lines, ...narrower(asks)].join('\n');
  },
};

/** Whether a package writes an entry for its bare name or a subpath: `exports`, `main` or `types`. */
const declaresEntry = (published: Documented): boolean =>
  ['exports', 'main', 'types'].some((key) => published.declared[key] !== undefined);

/**
 * Of the packages whose entry leads to no file, the one with the most imports
 * past it, ties and packages nothing imports in code-unit order.
 */
function mostReached(unfollowed: readonly Documented[], deep: readonly (readonly [string, number])[]): string | undefined {
  const names = new Set(unfollowed.map((published) => published.name));
  return deep.find(([owner]) => names.has(owner))?.[0] ?? [...names].sort(codeUnitOrder)[0];
}
