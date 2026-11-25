// compass: variance-authority.report.agent-surface

import { START_POINT_SCHEMA, saysStartPoint, startPointArg, type Tool, type ToolInvocation } from '@variance-authority/mcp/tools';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { kindOf, type Help } from '@variance-authority/package/help';
import { classifiedAreas, describedWordsNative, classifyNames, declarationsOf, packageLayers, sourceIndexPath } from '@variance-authority/sense';
import { searchIndexOf, storeBytesOf } from '../snapshot.js';
import { reachLine, reachOf, type Reach } from './area.js';
import { classifyWords, formatClassified, formatNamedFiles, lookedUp, namedFiles, unshownFiles, ownerOf, placedAreas, wordsOf, type CodeMapPlaces, type Locate, type Named, type StartPoint } from './classify-words.js';
import { noCodeMap, unfoldedCodeMap } from './code-map-format.js';
import { termsOfStems } from './loose.js';

/** How many declarations or files of one word are written out before the rest are counted. */
const LOCATED_CAP = 3;

/** How many files of one name are ordered by their importers; past them, a name every folder repeats is counted, not read. */
const FILES_READ = 64;

/**
 * Every package on the code map beside the source index, with its innermost
 * area and its dependency layer, in one read of the map. The sentence that
 * says why when no map is kept; when none was folded, no package and that
 * sentence beside it, since a declared name or a file needs no package.
 */
function placesOf(root: string): CodeMapPlaces | string {
  const layers = packageLayers(root);
  if (layers === undefined) return noCodeMap(sourceIndexPath(root));
  if (layers.packages === undefined || layers.packages === null) {
    return { current: layers.current, packages: new Map(), unfolded: unfoldedCodeMap(sourceIndexPath(root), layers.unmade ?? undefined) };
  }
  return {
    current: layers.current,
    packages: new Map(layers.packages.map(({ package: name, area, layer, directory }) => [name, area == null ? { layer, directory } : { area, layer, directory }] as const)),
  };
}

/** One place a word was found: a declaration's line, or none for a file. */
interface Found {
  readonly at: string;
  readonly line?: number;
  readonly test: boolean;
}

/**
 * Exact declarations and indexed filenames, ordered by reach, source kind,
 * importer count, path and line. Only the shown rows and remaining counts are
 * rendered; an unavailable snapshot is reported through `unread`.
 */
function locating(
  root: string,
  places: CodeMapPlaces,
  invocation: ToolInvocation<Help> | undefined,
  unread: { why?: string },
  inReach: ((file: string) => boolean) | undefined,
): Locate {
  return (words, filesOnly = new Set()) => {
    const owning = ownerOf(places.packages);
    const found = classifyNames(root, words, FILES_READ, invocation?.sourceIndex);
    if (found.refused != null) unread.why = found.refused;
    const named = new Map(found.named.map((one) => [one.name, one]));
    // An export already says where it is declared, so only its files are added.
    const declared = new Map(words.map((word) => [word, filesOnly.has(word) ? [] : found.declared
      .filter((one) => one.name === word)
      .map(({ at, line }) => ({ at, line, test: kindOf(at) !== 'source' }))] as const));
    // One read of the import graph counts every path either kind holds.
    const paths = [...new Set([...[...declared.values()].flatMap((found) => found.map((one) => one.at)), ...[...named.values()].flatMap((one) => one.files)])];
    const counts = invocation?.tree === undefined || paths.length === 0 ? [] : invocation.tree.importers(paths);
    const importers = new Map(paths.map((path, at) => [path, counts[at] ?? 0]));
    const outside = (found: Found): number => Number(inReach !== undefined && !inReach(found.at));
    const order = (one: Found, other: Found): number =>
      outside(one) - outside(other) ||
      Number(one.test) - Number(other.test) ||
      (importers.get(other.at) ?? 0) - (importers.get(one.at) ?? 0) ||
      codeUnitOrder(one.at, other.at) ||
      (one.line ?? 0) - (other.line ?? 0);
    const shown = (found: readonly Found[], kind: 'declared' | 'file', count = found.length): readonly Named[] => {
      const sorted = [...found].sort(order);
      return sorted.slice(0, LOCATED_CAP).map((one, at, kept) => ({
        kind,
        specifier: one.line === undefined ? one.at : `${one.at}:${one.line}`,
        file: one.at,
        package: owning(one.at) ?? '',
        published: false,
        ...(at === kept.length - 1 && count > kept.length ? { more: count - kept.length } : {}),
      }));
    };
    return new Map(words.map((word) => {
      const file = named.get(word);
      const asFiles = (file?.files ?? []).map((at) => ({ at, test: kindOf(at) !== 'source' }));
      return [word, [...shown(declared.get(word) ?? [], 'declared'), ...shown(asFiles, 'file', file?.count)]] as const;
    }));
  };
}

/** How many top-level declarations, and member lines with them, the addon reads of each named file; ample for eight functions and classes. */
const DECLARATION_LINES = 400;

/**
 * What each file the request names declares, from the source index alone: no listing of the tree is taken, so a checkout git cannot list still
 * gets its block.
 */
function namedFileBlock(
  classified: ReturnType<typeof classifyWords>,
  root: string,
  sourceIndex: ToolInvocation<Help>['sourceIndex'],
  inReach: ((file: string) => boolean) | undefined,
): string {
  // Under a start point a named file it does not reach is not the answer to it.
  const files = namedFiles(classified, inReach);
  if (files.length === 0) return '';
  // Words left over, or a word that names no file here, leave the files answering part of the request.
  const rest = classified.plain.length > 0 || (classified.unknown?.length ?? 0) > 0 || classified.entities.some((entity) => namedFiles({ entities: [entity], plain: [] }, inReach).length === 0);
  // A generation the host read from above the workspace spells its files from there.
  const prefix = sourceIndex === undefined || sourceIndex.within === '' ? '' : `${sourceIndex.within}/`;
  const read = declarationsOf(root, files.map((file) => `${prefix}${file}`), DECLARATION_LINES, sourceIndex?.index);
  return formatNamedFiles(
    files,
    read?.map((one) => ({ ...one, file: one.file.slice(prefix.length) })),
    { rest, scoped: inReach !== undefined, unshown: unshownFiles(classified) },
  );
}

/** Whether a start point's walks reach a file; nothing to ask without one. */
function reachTest(walks: Reach['walks'] | undefined): ((file: string) => boolean) | undefined {
  if (walks === undefined) return undefined;
  const reached = [walks.from, walks.to].flatMap((walk) => (walk === undefined ? [] : [walk]));
  return (file) => reached.some((walk) => walk.chain(file).length > 0);
}

/**
 * `docs_classify` — which words of the asker's own sentence are names this
 * workspace publishes, each placed on the code map.
 *
 * Every other question takes a name or a pattern the asker already chose. This
 * one takes the request as it was written and says which of its words are,
 * whole, a package, an entrypoint, an exported or declared name or a file, so
 * the next question is asked about a name rather than a guess. Without a code
 * map it classifies nothing.
 */
export const classify: Tool<Help> = {
  name: 'docs_classify',
  description:
    'Which words of a request, as written, name a package on the code map or what this workspace publishes. A word is an entity when it is, ' +
    'whole, the name of a package on the code map or that name without its scope, an entrypoint\'s specifier (both without case), or a ' +
    'published exported name (as spelled). A word that is none of those and is shaped as an identifier (a capital past its first letter, an ' +
    'underscore, or a digit after a letter) is then, as spelled, a name docs_symbol finds a file declaring, and the base name of an ' +
    'indexed file before its first dot. A path from the workspace\'s root is the indexed file at it, and a word with a dot and no slash ' +
    'the indexed files of that name. Files are listed ordinary source before tests, then the more imported file first, three of each and the rest ' +
    'counted, each in the map package nearest at or above it, or in no package. A plain lowercase word is never looked up so, a path that is no indexed file names none, and a word ' +
    'that is only part of a name is not one. Each entity is listed with ' +
    'what it names, its package\'s area and dependency layer on the code map as docs_orient numbers them, then the ' +
    'words that name nothing on one line. When words remain unrecognized or `from` or `to` is supplied, it also ranks the areas the words point to, ten at most, best first: a directory of at ' +
    'most 500 files held by the published source index, scored by the request\'s words, by stem, that its path, its files\' names and the top-level names its files ' +
    'declare, exported or not, hold, a word held by fewer areas counting for more and every declared name counting once per file in an area\'s length whatever its export visibility; each with the package on the code map nearest at or above it, and that package\'s area and layer. With `from` or `to`, only the files that start point reaches along the ' +
    'imports are ranked: a product\'s folder and the shared code it imports. It ends with the source files the request names, each with up to ' +
    'eight functions and classes it declares, exported first: they are the answer. Ask it first when holding a request in words, with or without names and paths in them.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The request, in the asker\'s own words.' },
      from: START_POINT_SCHEMA.from,
      to: START_POINT_SCHEMA.to,
    },
    required: ['query'],
    additionalProperties: false,
  },

  // The import graph orders the places a looked-up word is found, so it is read for one.
  wants: (input) => saysStartPoint(input) || (typeof input['query'] === 'string' && wordsOf(input['query']).some(lookedUp)),

  run(help, input, invocation) {
    const query = typeof input['query'] === 'string' ? input['query'] : '';
    if (query.trim() === '') throw new Error('`classify` takes the request to read as `query`');
    const root = invocation?.root;
    if (root === undefined) {
      throw new Error('`classify` reads the code map a checkout keeps, and this host named no checkout to read');
    }
    // The map names the packages, so without one nothing is classified.
    const places = placesOf(root);
    if (typeof places === 'string') return places;
    // The addon ranks the published source-index inventory, scoped by the start point's
    // walks; only the ten areas cross.
    const from = startPointArg(input, 'from');
    const to = startPointArg(input, 'to');
    const said: StartPoint | undefined =
      from === undefined && to === undefined
        ? undefined
        : { ...(from === undefined ? {} : { from: [from].flat() }), ...(to === undefined ? {} : { to: [to].flat() }) };
    const reach = said === undefined ? undefined : reachOf(from, to, invocation?.tree);
    const inReach = reachTest(reach?.walks);
    const unread: { why?: string } = {};
    const reading = classifyWords(query, help, places.packages.keys(), locating(root, places, invocation, unread, inReach));
    const classified = unread.why === undefined ? reading : {
      ...reading,
      plain: reading.plain.filter((word) => !lookedUp(word)),
      unknown: reading.plain.filter(lookedUp),
    };
    // A word the snapshot could not look up is not said to name none, and the
    // named files come last: they are the answer the rest leads to.
    const unlisted = unread.why === undefined ? '' : `\n\nNo word is looked up as a filename or declaration: ${unread.why.split('\n')[0]}.`;
    if (from === undefined && to === undefined && classified.entities.length > 0 && classified.plain.length === 0) {
      return `${formatClassified(classified, places)}${unlisted}${namedFileBlock(classified, root, invocation?.sourceIndex, inReach)}`;
    }
    const tail = (refusal = ''): string => `${unlisted}${refusal}${namedFileBlock(classified, root, invocation?.sourceIndex, inReach)}`;
    // A stem admits the dictionary terms `search` admits for it, resolved here once.
    const store = storeBytesOf(help);
    const terms = store === undefined ? [] : termsOfStems(searchIndexOf(help), describedWordsNative(query).map(([stem]) => stem));
    const ranked = classifiedAreas(root, query, {
      terms,
      store,
      ...(invocation?.sourceIndex === undefined ? {} : { index: invocation.sourceIndex.index, within: invocation.sourceIndex.within }),
      ...(reach === undefined ? {} : { scope: reach.walks }),
    });
    // An unavailable source index ranks no area, says why, and answers the entities all the same.
    if (ranked.refused != null) {
      const why = ranked.refused.split('\n')[0];
      return `${formatClassified(classified, places)}${tail(`\n\nNo area is ranked: ${why}.`)}`;
    }
    if (reach === undefined) return `${formatClassified(classified, places, placedAreas(ranked.areas, places.packages))}${tail()}`;
    const line = reachLine({ ...reach, files: ranked.reached, unresolved: ranked.unresolved });
    if (reach.refused !== undefined) throw new Error(`\`classify\` ranked nothing: ${line}`);
    return `${line}\n\n${formatClassified(classified, places, placedAreas(ranked.areas, places.packages), said)}${tail()}`;
  },
};
