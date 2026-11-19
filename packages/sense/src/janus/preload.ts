// compass: variance-authority.reach
/**
 * The two preloads that serve a `variance janus` run's manifest in every
 * process it starts, as `NODE_OPTIONS` names them: `serve-fs.cjs` through
 * `--require` and `serve-modules.mjs` through `--import`.
 */

import { fileURLToPath } from 'node:url';

/** `NODE_OPTIONS` flags that load both preloads, each path quoted. */
export const JANUS_PRELOAD = `--require ${JSON.stringify(fileURLToPath(new URL('./serve-fs.cjs', import.meta.url)))} --import ${JSON.stringify(new URL('./serve-modules.mjs', import.meta.url).href)}`;
