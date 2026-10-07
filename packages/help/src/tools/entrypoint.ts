import { codeUnitOrder } from '@variance-authority/core/segment';
import type { Tool } from '@variance-authority/mcp/tools';
import { stringArg } from '@variance-authority/mcp/tools';
import type { Deep, Documented, Help } from '@variance-authority/package/help';
import {
  type FileTaken,
  REACHING,
  UNFOLLOWED,
  counted,
  isName,
  ownerOf,
  perFile,
  reachingPast,
  surfaceByPath,
  takenByPath,
  tally,
  unfollowedEntry,
  unfollowedOf,
} from './by-path.js';
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
 * the package's name, the answer counts those imports after the names, one row
 * per file they reach, and lists no site: a package imported from ten thousand
 * places would otherwise answer with ten thousand lines. Each row names the
 * specifier to ask for, and asked by a specifier no entry opens, the answer
 * lists the imports written as that specifier, one line per site. A package whose
 * `exports` opens only subpaths has no names to list under its name, so the
 * specifiers it opens are listed in their place.
 */
export const entrypoint: Tool<Help> = {
  name: 'docs_entrypoint',
  description:
    'Every name one import specifier opens, ordered by how many packages import it, with its ' +
    'kind and the first line of its documentation. Names marked UNDOCUMENTED have nothing ' +
    'written above them — the source is the only thing that says what they do. Asked by a ' +
    "package's name, it also counts the imports that reach past the package's entry, one row per file " +
    'they reach; asked by one of those specifiers, it lists the import sites of that specifier. For a ' +
    'package that opens only subpaths, asked by its name, it lists the specifiers it opens. For a ' +
    'package that declares no entry it counts what other packages import from it by path, the same way. ' +
    'Use docs_symbol for the full ' +
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
    // `.` is the default the schema names, so asking for it is not asking for a subpath.
    const given = input['subpath'];
    const subpath = typeof given === 'string' && given !== '' && given !== '.' ? given : undefined;
    const said = stringArg(input, 'package');
    // One string, the way an import line writes it, whichever way it was asked.
    const asked = subpath === undefined ? said : `${said}${subpath.replace(/^\./u, '')}`;
    const owner = ownerOf(asked);

    const unentered = unenteredAnswer(help, asked, owner);
    if (unentered !== undefined) return sites(help, unentered);

    const published = help.packages.find((candidate) => candidate.name === owner);
    if (asked !== owner) {
      const naming = unfollowedOf(help, owner).filter((held) => held.specifier === asked);
      if (naming.length > 0) return sites(help, unfollowedSites(naming, asked));
      const reaching = reachingPast(help, owner, asked);
      if (reaching.length > 0) return sites(help, pastEntry(reaching, owner, 'sites'));
      if (published !== undefined && unfollowedEntry(published)) {
        throw new Error(`\`${asked}\`: ${owner} declares an entry ${UNFOLLOWED}, and no other package imports this specifier`);
      }
    } else if (published !== undefined && unfollowedEntry(published) && subpath === undefined) {
      const heading = `${owner} declares an entry ${UNFOLLOWED}, so none of its names are listed.`;
      const past = beyond(help, owner);
      if (past === undefined) return `${heading} No other package imports it.`;
      return sites(help, { ...past, lines: [heading, '', ...past.lines] });
    } else if (published !== undefined && subpath === undefined && !published.openings.some((held) => held.subpath === '.')) {
      return subpathsOnly(help, published);
    }

    const [door, held] = doorOf(help, said, subpath);
    const names = held.entries.length === 0
      ? [`${specifierOf(door, held)} opens no names.`]
      : [`${specifierOf(door, held)} — ${plural(held.entries.length, 'name')}`, '', ...held.entries.map(line)];
    // The package asked by its name alone: the imports past its entry are part of what it is used for.
    const past = subpath === undefined && said === door.name ? beyond(help, door.name) : undefined;
    if (past === undefined) return names.join('\n');
    return sites(help, { ...past, lines: [...names, '', ...past.lines] });
  },
};

/** Import sites, and the commands that narrow them. */
interface Sites {
  readonly lines: readonly string[];
  readonly asks: readonly string[];
}

/**
 * The imports past the entry of `owner`: asked by the package, one row per file
 * they reach, and asked by one specifier, one line per import of it. The
 * narrower questions follow from what is printed.
 */
function pastEntry(reaching: readonly Deep[], owner: string, grain: 'files' | 'sites'): Sites {
  const heading = `${plural(reaching.length, 'import reaches', 'imports reach')} past a published entrypoint of ${owner}. ${REACHING}`;
  if (grain === 'files') {
    const files = perFile(reaching);
    return { lines: [`${heading}. By file, most imported first:`, ...files.map(fileRow)], asks: filesAsks(files) };
  }
  const first = reaching
    .flatMap((held) => held.names.map((taken) => taken.name))
    .filter(isName)
    .sort(codeUnitOrder)[0];
  return {
    lines: [`${heading}:`, ...reaching.map((held) => `  ${held.specifier} — ${held.by} at ${held.at}:${held.line}`)],
    asks: first === undefined ? [] : [usesOf(first, reaching[0]!.specifier)],
  };
}

/** `<specifier> — N names, imported by M files`, the file's other spellings after a comma. */
const fileRow = (file: FileTaken): string =>
  `  ${file.specifiers.join(', ')} — ${plural(file.names, 'name')}, imported by ${plural(file.importers, 'file')}`;

/**
 * The questions that list the sites behind the first row: its specifier, and
 * its most-taken name through it. The specifier is not asked again when it is
 * the package's name, which is the question that printed the row.
 */
function filesAsks(files: readonly FileTaken[], owner?: string): readonly string[] {
  const top = files[0];
  if (top === undefined) return [];
  const specifier = top.specifiers[0]!;
  return [
    ...(specifier === owner ? [] : [`variance ask entrypoint --package ${shell(specifier)}`]),
    ...(top.name === undefined ? [] : [usesOf(top.name, specifier)]),
  ];
}

/**
 * What `owner` is imported for besides the names its entries open, asked by its
 * name: the imports that name an entry this reading could not follow, and the
 * ones past every entry it declares, each counted per file. Nothing, when there
 * are neither.
 */
function beyond(help: Help, owner: string): Sites | undefined {
  const naming = unfollowedOf(help, owner);
  const reaching = reachingPast(help, owner);
  const parts: Sites[] = [];
  if (naming.length > 0) {
    const files = perFile(naming);
    const heading = `${plural(naming.length, 'import names', 'imports name')} an entry ${owner} declares that this reading could not follow, most imported first:`;
    parts.push({ lines: [heading, ...files.map(fileRow)], asks: filesAsks(files, owner) });
  }
  if (reaching.length > 0) parts.push(pastEntry(reaching, owner, 'files'));
  if (parts.length === 0) return undefined;
  return { lines: parts.flatMap((part, at) => [...(at === 0 ? [] : ['']), ...part.lines]), asks: parts.flatMap((part) => part.asks) };
}

/** The imports written as one specifier a manifest declares and this reading could not follow, one line per site. */
function unfollowedSites(naming: readonly Deep[], asked: string): Sites {
  const first = naming.flatMap((held) => held.names.map((taken) => taken.name)).filter(isName).sort(codeUnitOrder)[0];
  return {
    lines: [
      `${asked} is an entry ${UNFOLLOWED}, so none of its names are listed. ${plural(naming.length, 'import names', 'imports name')} it:`,
      ...naming.map((held) => `  ${held.specifier} — ${held.by} at ${held.at}:${held.line}`),
    ],
    asks: first === undefined ? [] : [usesOf(first, asked)],
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
  const past = beyond(help, published.name);
  if (past === undefined) return [...lines, ...narrower(asks)].join('\n');
  return sites(help, { lines: [...lines, '', ...past.lines], asks: [...asks, ...past.asks] });
}

/**
 * A package that declares no entry opens nothing, and what other packages
 * import from it by path is the answer in its place: counted per file when it
 * is asked by its name, and one line per name taken when asked by a specifier.
 */
function unenteredAnswer(help: Help, asked: string, owner: string): Sites | undefined {
  if (!help.byPath.some((held) => ownerOf(held.specifier) === owner)) return undefined;
  const heading = `${owner} declares no entry: no \`exports\`, \`main\` or \`types\`.`;
  if (asked === owner) {
    const imports = takenByPath(help).get(owner) ?? [];
    if (imports.length === 0) return { lines: [`${heading} No other package imports a file of it.`], asks: [] };
    const files = perFile(imports);
    const lines = [`${heading} Other packages import ${counted(tally(imports))} by path, most imported first:`, ...files.map(fileRow)];
    return { lines, asks: filesAsks(files) };
  }
  const surface = surfaceByPath(help, owner, asked);
  if (surface.lines.length === 0) return { lines: [`${heading} No other package imports ${asked}.`], asks: [] };
  const asks = surface.first === undefined ? [] : [usesOf(surface.first.name, surface.first.specifier)];
  return { lines: [`${heading} Other packages import ${plural(surface.names, 'name')} from ${asked} by path:`, ...surface.lines], asks };
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
