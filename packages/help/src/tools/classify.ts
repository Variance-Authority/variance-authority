// compass: variance-authority.report.agent-surface

import type { Tool } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { packageLayers, sourceIndexPath } from '@variance-authority/sense';
import { classifyWords, formatClassified, type CodeMapPlaces } from './classify-words.js';

/**
 * Every package on the code map beside the source index, with its innermost
 * area and its dependency layer, in one read of the map. The sentence that
 * says why when no map is kept, or none was folded.
 */
function placesOf(root: string): CodeMapPlaces | string {
  const layers = packageLayers(root);
  if (layers === undefined) return `No code map is kept beside the source index at ${sourceIndexPath(root)}; \`variance index\` folds one.`;
  if (layers.packages === undefined || layers.packages === null) {
    return `The source index at ${sourceIndexPath(root)} was folded into no code map, because ${layers.unmade ?? 'there is no package to fold'}.`;
  }
  return {
    current: layers.current,
    packages: new Map(layers.packages.map(({ package: name, area, layer }) => [name, area == null ? { layer } : { area, layer }] as const)),
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
 */
export const classify: Tool<Help> = {
  name: 'docs_classify',
  description:
    'Which words of a request, as written, are names this workspace publishes. A word is an entity when it is, ' +
    'whole, the name of a package on the code map or that name without its scope, an entrypoint\'s specifier (both without case), or a ' +
    'published exported name (as spelled); a word that is only part of a name is not one. Each entity is listed with ' +
    'what it names, its package\'s area and dependency layer on the code map as docs_orient numbers them, then the ' +
    'words that name nothing on one line. Ask it first when holding a request in words and no name.',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The request, in the asker\'s own words.' },
    },
    required: ['query'],
    additionalProperties: false,
  },

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
    return formatClassified(classifyWords(query, help, places.packages.keys()), places);
  },
};
