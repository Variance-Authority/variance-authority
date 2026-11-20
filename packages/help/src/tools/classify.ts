// compass: variance-authority.report.agent-surface

import type { Tool } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { codeMapPage, packageLayers } from '@variance-authority/sense';
import { classifyWords, formatClassified, type Placed, type Placements } from './classify-words.js';

/**
 * Each package's innermost area and its dependency layer, read from the code
 * map beside the source index: every page from the top down, a package taken
 * by the deepest area that lists it. Absent when no map is kept, or none was
 * folded, with the sentence that says so.
 */
function placementsOf(root: string): Placements | string {
  const { index, answer } = codeMapPage(root);
  if (answer === undefined) return `No code map is kept beside the source index at ${index}; \`variance index\` folds one.`;
  if (answer.layers === undefined || answer.layers === null || answer.page === undefined || answer.page === null) {
    return `The source index at ${index} was folded into no code map, because ${answer.unmade ?? 'there is no package to fold'}.`;
  }
  const areas = new Map<string, NonNullable<Placed['area']>>();
  const pages = answer.page.rows.map((row) => row.id);
  for (let id = pages.shift(); id !== undefined; id = pages.shift()) {
    const page = codeMapPage(root, id).answer?.page;
    if (page === undefined || page === null) continue;
    for (const name of page.list) areas.set(name, { id: page.id, name: page.name });
    pages.push(...page.rows.map((row) => row.id));
  }
  const layers = new Map((packageLayers(root)?.packages ?? []).map((held) => [held.package, held.layer] as const));
  const named = new Set([...areas.keys(), ...layers.keys()]);
  return new Map([...named].map((name) => {
    const area = areas.get(name);
    const layer = layers.get(name);
    return [name, { ...(area === undefined ? {} : { area }), ...(layer === undefined ? {} : { layer }) }] as const;
  }));
}

/**
 * `docs_classify` — which words of the asker's own sentence are names this
 * workspace publishes, each placed on the code map.
 *
 * Every other question takes a name or a pattern the asker already chose. This
 * one takes the request as it was written and says which of its words are,
 * whole, a package, an entrypoint or an exported name, so the next question is
 * asked about a name rather than a guess. It reads the code map the way
 * `docs_orient` does, and without one it classifies nothing.
 */
export const classify: Tool<Help> = {
  name: 'docs_classify',
  description:
    'Which words of a request, as written, are names this workspace publishes. A word is an entity when it is, ' +
    'whole, a package\'s name or that name without its scope, an entrypoint\'s specifier (both without case), or a ' +
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
    const placements = placementsOf(root);
    if (typeof placements === 'string') return placements;
    return formatClassified(classifyWords(query, help), placements);
  },
};
