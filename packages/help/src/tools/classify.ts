// compass: variance-authority.report.agent-surface

import { START_POINT_SCHEMA, saysStartPoint, startPointArg, type Tool, type ToolInvocation } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { declaredDescribedOf, describedWordsNative, packageLayers, privateWordsOf, sourceIndexPath, trackedFiles } from '@variance-authority/sense';
import { searchIndexOf } from '../snapshot.js';
import { areaLine, areaOf } from './area.js';
import { rankedAreas, type Declared } from './classify-areas.js';
import { classifyWords, formatClassified, placedAreas, type CodeMapPlaces, type StartPoint } from './classify-words.js';
import { noCodeMap, unfoldedCodeMap } from './code-map-format.js';
import { termsOfStems } from './loose.js';

/**
 * Every package on the code map beside the source index, with its innermost
 * area and its dependency layer, in one read of the map. The sentence that
 * says why when no map is kept, or none was folded.
 */
function placesOf(root: string): CodeMapPlaces | string {
  const layers = packageLayers(root);
  if (layers === undefined) return noCodeMap(sourceIndexPath(root));
  if (layers.packages === undefined || layers.packages === null) return unfoldedCodeMap(sourceIndexPath(root), layers.unmade ?? undefined);
  return {
    current: layers.current,
    packages: new Map(layers.packages.map(({ package: name, area, layer, directory }) => [name, area == null ? { layer, directory } : { area, layer, directory }] as const)),
  };
}

/**
 * What the source index says the files declare: for each of the request's
 * stems, the files declaring a name that holds it — an exported name, read the
 * way `search` reads the dictionary, or a top-level one no export binds — and
 * for each file how many words its exported and private names hold.
 */
function declaredOf(help: Help, root: string, query: string, sourceIndex: ToolInvocation<unknown>['sourceIndex']): Declared {
  const index = searchIndexOf(help);
  const stems = [...new Set((describedWordsNative(query) as readonly (readonly [string, string])[]).map(([stem]) => stem))];
  const holding = new Map<string, Map<string, number>>();
  termsOfStems(index, stems).forEach((terms, at) => {
    const files = new Map<string, number>();
    const names = new Set<number>();
    for (const term of terms) for (const name of index.termNames(term)) names.add(name);
    for (const name of names) {
      for (const row of index.exportedOf(name)) {
        const file = index.exportedAt(row);
        files.set(file, (files.get(file) ?? 0) + 1);
      }
    }
    holding.set(stems[at] ?? '', files);
  });
  // A file's own top-level names, which no export binds, are its words too,
  // read from the index the host read the tree from: a nested workspace's names
  // its files from the graph's root, so they are named from the workspace.
  const under = sourceIndex === undefined || sourceIndex.within === '' ? '' : `${sourceIndex.within}/`;
  for (const declared of declaredDescribedOf(root, query, stems, undefined, sourceIndex?.index)?.names ?? []) {
    if (declared.holder != null || declared.on != null || !declared.at.startsWith(under)) continue;
    const file = declared.at.slice(under.length);
    for (const at of declared.named ?? []) {
      const files = holding.get(stems[at] ?? '');
      if (files !== undefined) files.set(file, (files.get(file) ?? 0) + 1);
    }
  }
  // Each term lists the names holding it, so a name holds as many words as terms list it.
  const wordsOf = new Uint32Array(index.nameCount);
  for (let term = 0; term < index.termCount; term += 1) for (const name of index.termNames(term)) wordsOf[name] = (wordsOf[name] ?? 0) + 1;
  const words = new Map<string, number>();
  for (let name = 0; name < index.nameCount; name += 1) {
    const held = wordsOf[name] ?? 0;
    if (held === 0) continue;
    for (const row of index.exportedOf(name)) {
      const file = index.exportedAt(row);
      words.set(file, (words.get(file) ?? 0) + held);
    }
  }
  for (const row of privateWordsOf(root, undefined, sourceIndex?.index) ?? []) {
    if (!row.at.startsWith(under) || row.words === 0) continue;
    const file = row.at.slice(under.length);
    words.set(file, (words.get(file) ?? 0) + row.words);
  }
  return { holding, words };
}

/**
 * The tracked paths a start point reaches along the imports, with the line
 * that says which; every tracked path when none was said. The walk names files
 * from the graph's root, which a nested workspace sits below, so a file is
 * named from the workspace by the part after the offset the source index
 * names, and one outside the workspace is no tracked path of it.
 */
function scopedPaths(
  paths: readonly string[],
  input: Readonly<Record<string, unknown>>,
  invocation: ToolInvocation<unknown> | undefined,
): { readonly paths: readonly string[]; readonly line?: string; readonly said?: StartPoint } {
  const from = startPointArg(input, 'from');
  const to = startPointArg(input, 'to');
  if (from === undefined && to === undefined) return { paths };
  const said = { ...(from === undefined ? {} : { from: [from].flat() }), ...(to === undefined ? {} : { to: [to].flat() }) };
  const tree = invocation?.tree;
  const area = areaOf(from, to, tree);
  if (area.refused !== undefined || tree === undefined) throw new Error(`\`classify\` ranked nothing: ${areaLine(area)}`);
  const within = invocation?.sourceIndex?.within ?? '';
  const under = within === '' ? '' : `${within}/`;
  const reached = new Set([...area.files].flatMap((file) => (file.startsWith(under) ? [file.slice(under.length)] : [])));
  return { paths: paths.filter((path) => reached.has(path)), line: areaLine(area), said };
}

/**
 * `docs_classify` — which words of the asker's own sentence are names this
 * workspace publishes, each placed on the code map.
 *
 * Every other question takes a name or a pattern the asker already chose. This
 * one takes the request as it was written and says which of its words are,
 * whole, a package, an entrypoint or an exported name, so the next question is
 * asked about a name rather than a guess. Its packages are the code map's, read
 * the way `docs_orient` reads them, and without a map it classifies nothing.
 * Most of a request's words name nothing, so it then ranks the areas of the
 * tree they point to, which a request that names nothing still has.
 */
export const classify: Tool<Help> = {
  name: 'docs_classify',
  description:
    'Which words of a request, as written, name a package on the code map or what this workspace publishes. A word is an entity when it is, ' +
    'whole, the name of a package on the code map or that name without its scope, an entrypoint\'s specifier (both without case), or a ' +
    'published exported name (as spelled); a word that is only part of a name is not one. Each entity is listed with ' +
    'what it names, its package\'s area and dependency layer on the code map as docs_orient numbers them, then the ' +
    'words that name nothing on one line. Then the areas of the tree the words point to, ten at most, best first: a directory of at ' +
    'most 500 tracked files, scored by the request\'s words, by stem, that its path, its files\' names and the top-level names its files ' +
    'declare, exported or not, hold, a word held by fewer areas counting for more; each with the package on the code map nearest at or above it, and that package\'s area and layer. With `from` or `to`, only the files that start point reaches along the ' +
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

  wants: saysStartPoint,

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
    const classified = classifyWords(query, help, places.packages.keys());
    // The tree the words point to, read from what HEAD holds; a checkout git
    // cannot list ranks no area, says why, and answers the entities all the same.
    let tracked: readonly string[];
    try {
      tracked = trackedFiles(root);
    } catch (error) {
      const why = error instanceof Error ? error.message.split('\n')[0] : String(error);
      return `${formatClassified(classified, places)}\n\nNo area is ranked: git could not list the files HEAD holds (${why}).`;
    }
    const scoped = scopedPaths(tracked, input, invocation);
    const areas = scoped.paths.length === 0 ? [] : rankedAreas(query, scoped.paths, declaredOf(help, root, query, invocation?.sourceIndex));
    const answer = formatClassified(classified, places, placedAreas(areas, places.packages), scoped.said);
    return scoped.line === undefined ? answer : `${scoped.line}\n\n${answer}`;
  },
};
