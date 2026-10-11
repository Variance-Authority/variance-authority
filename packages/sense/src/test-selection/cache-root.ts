// compass: variance-authority.reach

/**
 * `@variance-authority/sense/cache-root` — where a checkout keeps its cache,
 * for a package that reads nothing else of Sense.
 *
 * The answer is {@link cacheRootFor}, the one the CLI gives, re-exported here
 * so that asking it does not load the parser, the resolver and the glob matcher
 * `@variance-authority/sense/test-selection` carries. The Vitest plugin asks it
 * at config load to keep its render cache out of a committed baseline root.
 */
export { cacheRootFor } from './cache-layers.js';
