// compass: variance-authority.report.agent-surface

import { START_POINT_SCHEMA, saysStartPoint, startPointArg, type Tool } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { classifiedAreas, packageLayers, sourceIndexPath } from '@variance-authority/sense';
import { storeBytesOf } from '../snapshot.js';
import { reachLine, reachOf } from './area.js';
import { classifyWords, formatClassified, placedAreas, type CodeMapPlaces, type StartPoint } from './classify-words.js';
import { noCodeMap, unfoldedCodeMap } from './code-map-format.js';

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
    // The addon lists what HEAD holds and ranks it, scoped by the start point's
    // walks; only the ten areas cross.
    const from = startPointArg(input, 'from');
    const to = startPointArg(input, 'to');
    const said: StartPoint | undefined =
      from === undefined && to === undefined
        ? undefined
        : { ...(from === undefined ? {} : { from: [from].flat() }), ...(to === undefined ? {} : { to: [to].flat() }) };
    const reach = said === undefined ? undefined : reachOf(from, to, invocation?.tree);
    const ranked = classifiedAreas(root, query, {
      store: storeBytesOf(help),
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
