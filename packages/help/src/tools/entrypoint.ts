import { codeUnitOrder } from '@variance-authority/core/segment';
import type { Tool } from '@variance-authority/mcp/tools';
import { stringArg } from '@variance-authority/mcp/tools';
import type { Deep, Documented, Help } from '@variance-authority/package/help';
import { REACHING, busiestOf, counted, isName, ownerOf, reachingPast, surfaceByPath } from './by-path.js';
import { doorOf, specifierOf } from './find.js';
import { line, mostUsed, narrower, openingRow, plural, shell } from './format.js';

/**
 * `docs_entrypoint` — what one import specifier opens, most-used first.
 *
 * The ordering is the answer. A published surface handed over alphabetically is
 * a thousand equally-weighted facts, and the name somebody needs is as likely to
 * be last as first; ordered by how much of the repository reaches for each name,
 * a reader who stops a third of the way in has read the third that gets used.
 *
 * ## What a package is imported for past its entry
 *
 * The names an entry opens are not all a package is imported for. Another
 * package can import one of its files by path: past the entry it declares, or
 * from a package that declares none and so has nothing else to import. Asked by
 * the package's name, the answer lists those imports after the names, one line
 * per site; asked by a specifier no entry opens, it lists the imports written as
 * that specifier. `docs_packages` counts them per package and names this
 * question; this is where the sites behind a count are listed. A package whose
 * `exports` opens only subpaths has no names to list under its name, so the
 * specifiers it opens are listed in their place.
 */
export const entrypoint: Tool<Help> = {
  name: 'docs_entrypoint',
  description:
    'Every name one import specifier opens, ordered by how many packages import it, with its ' +
    'kind and the first line of its documentation. Names marked UNDOCUMENTED have nothing ' +
    'written above them — the source is the only thing that says what they do. Asked by a ' +
    "package's name, it also lists each import that reaches past the package's entry; asked by a " +
    'specifier past the entry, it lists the imports of that specifier. For a package that opens only ' +
    'subpaths, asked by its name, it lists the specifiers it opens. For a package that declares ' +
    'no entry it lists what other packages import from it by path. Use docs_symbol for the full ' +
    'signature and documentation of one name.',
  inputSchema: {
    type: 'object',
    properties: {
      package: {
        type: 'string',
        description:
          'The specifier as docs_packages reports it, e.g. `@scope/name/file`, or the package ' +
          'name alone with the subpath given separately.',
      },
      subpath: {
        type: 'string',
        description: "Entrypoint subpath, e.g. './file'. Defaults to '.', the package's main entrypoint.",
      },
    },
    required: ['package'],
    additionalProperties: false,
  },

  run(help, input) {
    const subpath = typeof input['subpath'] === 'string' && input['subpath'] !== '' ? input['subpath'] : undefined;
    const said = stringArg(input, 'package');
    // One string, the way an import line writes it, whichever way it was asked.
    const asked = subpath === undefined || subpath === '.' ? said : `${said}${subpath.replace(/^\./u, '')}`;
    const owner = ownerOf(asked);

    const unentered = unenteredAnswer(help, asked, owner);
    if (unentered !== undefined) return sites(help, unentered);

    const published = help.packages.find((candidate) => candidate.name === owner);
    if (asked !== owner) {
      const reaching = reachingPast(help, owner, asked);
      if (reaching.length > 0) return sites(help, pastEntry(reaching, owner));
      if (published !== undefined && published.openings.length === 0) {
        throw new Error(`\`${asked}\`: ${owner} opens no entry, and no other package imports this specifier`);
      }
    } else if (published !== undefined && published.openings.length === 0 && subpath === undefined) {
      const reaching = reachingPast(help, owner);
      if (reaching.length === 0) return `${owner} opens no entry, and no other package imports a file of it.`;
      const past = pastEntry(reaching, owner);
      return sites(help, { ...past, lines: [`${owner} opens no entry.`, '', ...past.lines] });
    } else if (published !== undefined && subpath === undefined && !published.openings.some((held) => held.subpath === '.')) {
      return subpathsOnly(help, published);
    }

    const [door, held] = doorOf(help, said, subpath);
    const names = held.entries.length === 0
      ? [`${specifierOf(door, held)} opens no names.`]
      : [`${specifierOf(door, held)} — ${plural(held.entries.length, 'name')}`, '', ...held.entries.map(line)];
    // The package asked by its name alone: the imports past its entry are part of what it is used for.
    const reaching = subpath === undefined && said === door.name ? reachingPast(help, door.name) : [];
    if (reaching.length === 0) return names.join('\n');
    const past = pastEntry(reaching, door.name);
    return sites(help, { ...past, lines: [...names, '', ...past.lines] });
  },
};

/** Import sites, and the commands that narrow them. */
interface Sites {
  readonly lines: readonly string[];
  readonly asks: readonly string[];
}

/**
 * The imports past the entry of `owner`, one line per import, and the narrower
 * questions: the specifier with the most imports, ties in code-unit order, when
 * they are under more than one, and the first name taken in specifier then name
 * order.
 */
function pastEntry(reaching: readonly Deep[], owner: string): Sites {
  const first = reaching
    .flatMap((held) => held.names.map((taken) => [taken.name, held.specifier] as const))
    .filter(([name]) => isName(name))
    .sort((left, right) => codeUnitOrder(left[1], right[1]) || codeUnitOrder(left[0], right[0]))[0];
  const busiest = busiestOf(reaching.map((held) => held.specifier));
  return {
    lines: [
      `${plural(reaching.length, 'import reaches', 'imports reach')} past a published entrypoint of ${owner}. ${REACHING}:`,
      ...reaching.map((held) => `  ${held.specifier} — ${held.by} at ${held.at}:${held.line}`),
    ],
    asks: [
      ...(busiest === undefined ? [] : [`variance ask entrypoint --package ${shell(busiest)}`]),
      ...(first === undefined ? [] : [usesOf(...first)]),
    ],
  };
}

/**
 * A package whose `exports` opens subpaths and no `.`, asked by its name: there
 * is no main entry to list the names of, so the answer is the specifiers it
 * opens, counted the way `docs_packages` counts them, and the imports past them.
 */
function subpathsOnly(help: Help, published: Documented): string {
  const opened = published.openings.map((held) => [published, held] as const);
  const door = mostUsed(opened) ?? opened[0]!;
  const lines = [`${published.name} opens no main entry. It opens:`, ...opened.map((pair) => `  ${openingRow(...pair)}`)];
  const asks = [`variance ask entrypoint --package ${shell(specifierOf(...door))}`];
  const reaching = reachingPast(help, published.name);
  if (reaching.length === 0) return [...lines, ...narrower(asks)].join('\n');
  const past = pastEntry(reaching, published.name);
  return sites(help, { lines: [...lines, '', ...past.lines], asks: [...asks, ...past.asks] });
}

/**
 * A package that declares no entry opens nothing, and what other packages
 * import from it by path is the answer in its place.
 */
function unenteredAnswer(help: Help, asked: string, owner: string): Sites | undefined {
  if (!help.byPath.some((held) => ownerOf(held.specifier) === owner)) return undefined;
  const surface = surfaceByPath(help, owner, asked === owner ? undefined : asked);
  const { lines } = surface;
  const heading = `${owner} declares no entry: no \`exports\`, \`main\` or \`types\`.`;
  if (lines.length === 0) return { lines: [`${heading} No other package imports ${asked === owner ? 'a file of it' : asked}.`], asks: [] };
  const count = asked === owner ? counted(surface) : `${plural(surface.names, 'name')} from ${asked}`;
  const asks = [
    ...(surface.busiest === undefined ? [] : [`variance ask entrypoint --package ${shell(surface.busiest)}`]),
    ...(surface.first === undefined ? [] : [usesOf(surface.first.name, surface.first.specifier)]),
  ];
  return { lines: [`${heading} Other packages import ${count} by path:`, ...lines], asks };
}

/**
 * Asked by the specifier the name was taken through, because `uses` asked by
 * the package joins an import by path only to the published name of that
 * spelling, and a file past the entry can export a name the entry publishes
 * from another file.
 */
function usesOf(name: string, specifier: string): string {
  return `variance ask uses --name ${shell(name)} --package ${shell(specifier)}`;
}

/**
 * The sites, that they are a floor when a file could not be read — a missed
 * import is a missing line — and the narrower questions last.
 */
function sites(help: Help, answer: Sites): string {
  const missed = help.unreadable.length;
  const floor =
    missed === 0
      ? []
      : ['', `${plural(missed, 'file')} could not be read, so these imports are a floor; \`variance ask packages\` lists ${missed === 1 ? 'it' : 'them'}.`];
  return [...answer.lines, ...floor, ...narrower(answer.asks)].join('\n');
}
