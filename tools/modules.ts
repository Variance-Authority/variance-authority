import { MODULES as TRACKED, tracked as list } from './modules.mjs';

/** Every tracked module, as `tools/modules.mjs` lists them. */
export const MODULES: readonly string[] = TRACKED;

/** Tracked files under the patterns, as `git ls-files` names them. */
export const tracked: (...patterns: string[]) => string[] = list;
