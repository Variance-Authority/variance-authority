import type { Tool } from '@variance-authority/mcp/tools';
import type { Deep, Documented, Help, Opening } from '@variance-authority/package/help';
import { byCodeUnit, counted, countsByPath, ownerOf, surfaceByPath } from './by-path.js';
import { NOTHING_PUBLISHED, specifierOf } from './find.js';
import { plural, shell } from './orient-format.js';

/**
 * `docs_packages` — what each package in this workspace is imported for, counted.
 *
 * Each row is a package or a specifier, because that is what every other tool
 * here takes: a package with four entrypoints is four different imports, and a
 * list of package names would leave three of them to be guessed.
 *
 * With no package it counts, and lists no import. The sites behind a count are
 * the answer to a narrower question, and the narrower question is printed with
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
    'entrypoint are counted per package. Every row names the argument of docs_entrypoint, or of this ' +
    'tool as `package`, which lists the import sites behind the counts. With nothing in hand, ' +
    'docs_orient with no files prints the code map.',
  inputSchema: {
    type: 'object',
    properties: {
      package: {
        type: 'string',
        description:
          'The package, by name or by specifier, as the answer with no package lists it. Lists the ' +
          'imports behind its counts. Optional.',
      },
    },
    additionalProperties: false,
  },

  run(help, input) {
    const asked = typeof input['package'] === 'string' && input['package'] !== '' ? input['package'] : undefined;
    return asked === undefined ? overview(help) : onePackage(help, asked);
  },
};

const REACHING =
  'Either the manifest has stopped describing what the package is used for, or something is reaching into its internals';

/** Every package, one row each, and the questions that open one. */
function overview(help: Help): string {
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
  const asks = [
    ...(door === undefined ? [] : [`variance ask entrypoint --package ${shell(specifierOf(...door))}`]),
    ...[counts.unentered[0]?.[0], counts.deep[0]?.[0]]
      .filter((owner) => owner !== undefined)
      .map((owner) => `variance ask packages --package ${shell(owner)}`),
  ];
  return [...lines, ...narrower(asks)].join('\n');
}

/** One package, or one specifier of it: its rows, and the import sites behind them. */
function onePackage(help: Help, asked: string): string {
  const owner = ownerOf(asked);
  const specifier = asked === owner ? undefined : asked;
  const published = help.packages.find((candidate) => candidate.name === owner);
  const opened =
    published === undefined
      ? []
      : published.openings
          .filter((held) => specifier === undefined || specifierOf(published, held) === specifier)
          .map((held) => [published, held] as const);
  const lines = opened.map(([pkg, held]) => openingRow(pkg, held));
  const door = mostUsed(opened);
  const asks = door === undefined ? [] : [`variance ask entrypoint --package ${shell(specifierOf(...door))}`];

  const reaching = help.deep
    .filter((held) => (specifier === undefined ? ownerOf(held.specifier) === owner : held.specifier === specifier))
    .sort(bySite);
  if (reaching.length > 0) {
    section(
      lines,
      `${plural(reaching.length, 'import reaches', 'imports reach')} past a published entrypoint of ${owner}. ${REACHING}:`,
      ...reaching.map((held) => `  ${held.specifier} — ${held.by} at ${held.at}:${held.line}`),
    );
    asks.push(...usesOf(reaching.flatMap((held) => held.names.map((taken) => taken.name)).find(isName), asked));
  }

  const surface = surfaceByPath(help, owner, specifier);
  if (surface.lines.length > 0) {
    section(
      lines,
      `${owner} declares no entry. Other packages import ${counted(surface)} by path:`,
      ...surface.lines,
    );
    asks.push(
      ...(surface.busiest === undefined ? [] : [`variance ask packages --package ${shell(surface.busiest)}`]),
      ...usesOf(surface.first, asked),
    );
  }

  if (lines.length === 0) {
    if (published !== undefined && specifier === undefined) return `${owner} opens no entry, and no other package imports a file of it.`;
    throw new Error(
      `\`${asked}\`: nothing in this workspace publishes it and no other package imports it; \`variance ask packages\` counts the ones there are`,
    );
  }
  if (help.unreadable.length > 0) {
    section(lines, `${plural(help.unreadable.length, 'file')} could not be read, so these counts are floors; \`variance ask packages\` lists them.`);
  }
  return [...lines, ...narrower(asks)].join('\n');
}

/** `<specifier> — N names, U imported elsewhere, D documented`. */
function openingRow(published: Documented, held: Opening): string {
  const used = held.entries.filter((entry) => entry.usedBy.length > 0).length;
  const written = held.entries.filter((entry) => entry.doc !== undefined).length;
  return `${specifierOf(published, held)} — ${plural(held.entries.length, 'name')}, ${used} imported elsewhere, ${written} documented`;
}

/** The door whose names the most packages import, the first of equals. */
function mostUsed(
  opened: readonly (readonly [Documented, Opening])[],
): readonly [Documented, Opening] | undefined {
  const used = ([, held]: readonly [Documented, Opening]): number => held.entries.filter((entry) => entry.usedBy.length > 0).length;
  return opened.reduce<readonly [Documented, Opening] | undefined>(
    (best, door) => (best === undefined || used(door) > used(best) ? door : best),
    undefined,
  );
}

/** A name a reader could ask `uses` about: not the whole module, not a side effect. */
const isName = (name: string): boolean => name !== '' && name !== '*';

function usesOf(name: string | undefined, asked: string): readonly string[] {
  return name === undefined ? [] : [`variance ask uses --name ${shell(name)} --package ${shell(asked)}`];
}

function narrower(asks: readonly string[]): readonly string[] {
  return asks.length === 0 ? [] : ['', 'Narrower questions:', ...asks.map((command) => `  ${command}`)];
}

/** `block` after what `lines` already holds, a blank line between them. */
function section(lines: string[], ...block: readonly string[]): void {
  lines.push(...(lines.length > 0 ? [''] : []), ...block);
}

function bySite(left: Deep, right: Deep): number {
  return byCodeUnit(left.specifier, right.specifier) || byCodeUnit(left.at, right.at) || left.line - right.line;
}
