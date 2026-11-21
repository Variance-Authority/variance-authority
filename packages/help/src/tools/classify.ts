// compass: variance-authority.report.agent-surface

import { START_POINT_SCHEMA, saysStartPoint, startPointArg, type Tool, type Tree } from '@variance-authority/mcp/tools';
import { kindOf, type Help } from '@variance-authority/package/help';
import { classifiedAreas, describedWordsNative, filesNamed, packageLayers, sourceIndexPath } from '@variance-authority/sense';
import { searchIndexOf, storeBytesOf } from '../snapshot.js';
import { reachLine, reachOf } from './area.js';
import { classifyWords, formatClassified, identifier, ownerOf, placedAreas, wordsOf, type CodeMapPlaces, type Locate, type Named, type StartPoint } from './classify-words.js';
import { noCodeMap, unfoldedCodeMap } from './code-map-format.js';
import { answering, says } from './declaration-key.js';
import { declarations } from './declared.js';
import { termsOfStems } from './loose.js';

/** How many declarations or files of one word are written out before the rest are counted. */
const LOCATED_CAP = 3;

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
 * Where each identifier-shaped word is declared at top level, exported or not,
 * and which tracked files are named it: ordinary source before tests and
 * stories, then the files more files import first, then by path in code units
 * and line. The first few of each kind are kept, and the rest counted.
 */
function locating(help: Help, root: string, places: CodeMapPlaces, tree: Tree | undefined): Locate {
  return (words) => {
    const owning = ownerOf(places.packages);
    const files = filesNamed(root, words);
    const named = 'unread' in files ? new Map<string, readonly string[]>() : files;
    const declared = new Map<string, readonly Found[]>();
    for (const word of words) {
      const read = declarations(root, word);
      const kept = 'refused' in read ? [] : read.names.filter((one) => one.holderLine == null && one.on == null);
      const found = new Map<string, Found>();
      for (const one of kept) found.set(`${one.at}:${one.line}`, { at: one.at, line: one.line, test: one.fileKind !== 'source' });
      // An export binds a declaration of its own file; one only passing a name on declares nothing.
      for (const one of answering(help, root, word)) {
        if (one.bound === undefined || !(says(one.name, word) || one.bound === word)) continue;
        const line = one.boundLine ?? one.line;
        found.set(`${one.at}:${line}`, { at: one.at, line, test: kindOf(one.at) !== 'source' });
      }
      declared.set(word, [...found.values()]);
    }
    // One read of the import graph counts every path either kind holds.
    const paths = [...new Set([...declared.values(), ...named.values()].flatMap((found) => found.map((one) => (typeof one === 'string' ? one : one.at))))];
    const counts = tree === undefined || paths.length === 0 ? [] : tree.importers(paths);
    const importers = new Map(paths.map((path, at) => [path, counts[at] ?? 0]));
    const order = (one: Found, other: Found): number =>
      Number(one.test) - Number(other.test) ||
      (importers.get(other.at) ?? 0) - (importers.get(one.at) ?? 0) ||
      (one.at < other.at ? -1 : one.at > other.at ? 1 : 0) ||
      (one.line ?? 0) - (other.line ?? 0);
    const shown = (found: readonly Found[], kind: 'declared' | 'file'): readonly Named[] => {
      const sorted = [...found].sort(order);
      return sorted.slice(0, LOCATED_CAP).map((one, at, kept) => ({
        kind,
        specifier: one.line === undefined ? one.at : `${one.at}:${one.line}`,
        package: owning(one.at) ?? '',
        published: false,
        ...(at === kept.length - 1 && sorted.length > kept.length ? { more: sorted.length - kept.length } : {}),
      }));
    };
    return new Map(words.map((word) => [word, [
      ...shown(declared.get(word) ?? [], 'declared'),
      ...shown((named.get(word) ?? []).map((at) => ({ at, test: kindOf(at) !== 'source' })), 'file'),
    ]] as const));
  };
}

/**
 * `docs_classify` — which words of the asker's own sentence are names this
 * workspace publishes, each placed on the code map.
 *
 * Every other question takes a name or a pattern the asker already chose. This
 * one takes the request as it was written and says which of its words are,
 * whole, a package, an entrypoint or an exported name, so the next question is
 * asked about a name rather than a guess; then, of the identifier-shaped words
 * left, which are a name the source index holds declared or a file git tracks
 * by that name, each in the map package nearest above it. Its packages are the
 * code map's, read the way `docs_orient` reads them, and without a map it
 * classifies nothing; a map folded with no package still places declarations
 * and files, in no package.
 * Unresolved words or an explicit start point also rank the areas of the tree
 * the request points to; fully recognized unscoped requests use exact follow-ups.
 */
export const classify: Tool<Help> = {
  name: 'docs_classify',
  description:
    'Which words of a request, as written, name a package on the code map or what this workspace publishes. A word is an entity when it is, ' +
    'whole, the name of a package on the code map or that name without its scope, an entrypoint\'s specifier (both without case), or a ' +
    'published exported name (as spelled). A word shaped as an identifier (a capital past its first letter, an underscore, or a digit ' +
    'after a letter) that is none of those is then, as spelled, a top-level name a file declares, exported or not, and the base name of a ' +
    'tracked file without its extension: ordinary source before tests, then the more imported file first, three of each and the rest ' +
    'counted, each in the map package nearest at or above it, or in no package. A plain lowercase word is never looked up so, and a word ' +
    'that is only part of a name is not one. Each entity is listed with ' +
    'what it names, its package\'s area and dependency layer on the code map as docs_orient numbers them, then the ' +
    'words that name nothing on one line. When words remain unrecognized or `from` or `to` is supplied, it also ranks the areas the words point to, ten at most, best first: a directory of at ' +
    'most 500 tracked files, scored by the request\'s words, by stem, that its path, its files\' names and the top-level names its files ' +
    'declare, exported or not, hold, a word held by fewer areas counting for more and every declared name counting once per file in an area\'s length whatever its export visibility; each with the package on the code map nearest at or above it, and that package\'s area and layer. With `from` or `to`, only the files that start point reaches along the ' +
    'imports are ranked: a product\'s folder and the shared code it imports. Ask it first when holding a request in words and no name.',
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

  // The import graph orders the places an identifier-shaped word is found, so it is read for one.
  wants: (input) => saysStartPoint(input) || (typeof input['query'] === 'string' && wordsOf(input['query']).some(identifier)),

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
    const classified = classifyWords(query, help, places.packages.keys(), locating(help, root, places, invocation?.tree));
    // The addon lists what HEAD holds and ranks it, scoped by the start point's
    // walks; only the ten areas cross.
    const from = startPointArg(input, 'from');
    const to = startPointArg(input, 'to');
    if (from === undefined && to === undefined && classified.entities.length > 0 && classified.plain.length === 0) {
      return formatClassified(classified, places);
    }
    const said: StartPoint | undefined =
      from === undefined && to === undefined
        ? undefined
        : { ...(from === undefined ? {} : { from: [from].flat() }), ...(to === undefined ? {} : { to: [to].flat() }) };
    const reach = said === undefined ? undefined : reachOf(from, to, invocation?.tree);
    // A stem admits the dictionary terms `search` admits for it, resolved here once.
    const store = storeBytesOf(help);
    const terms = store === undefined ? [] : termsOfStems(searchIndexOf(help), describedWordsNative(query).map(([stem]) => stem));
    const ranked = classifiedAreas(root, query, {
      terms,
      store,
      ...(invocation?.sourceIndex === undefined ? {} : { index: invocation.sourceIndex.index, within: invocation.sourceIndex.within }),
      ...(reach === undefined ? {} : { scope: reach.walks }),
    });
    // A checkout git cannot list ranks no area, says why, and answers the entities all the same.
    if (ranked.refused != null) {
      const why = ranked.refused.split('\n')[0];
      return `${formatClassified(classified, places)}\n\nNo area is ranked: git could not list the files HEAD holds (${why}).`;
    }
    if (reach === undefined) return formatClassified(classified, places, placedAreas(ranked.areas, places.packages));
    const line = reachLine({ ...reach, files: ranked.reached, unresolved: ranked.unresolved });
    if (reach.refused !== undefined) throw new Error(`\`classify\` ranked nothing: ${line}`);
    return `${line}\n\n${formatClassified(classified, places, placedAreas(ranked.areas, places.packages), said)}`;
  },
};
