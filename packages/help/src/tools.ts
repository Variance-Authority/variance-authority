import type { Served, Tool } from '@variance-authority/mcp';
import type { Help } from '@variance-authority/package/help';
import { entrypoint } from './tools/entrypoint.js';
import { gaps } from './tools/gaps.js';
import { packages } from './tools/packages.js';
import { search } from './tools/search.js';
import { symbol } from './tools/symbol.js';

/**
 * The five questions, and the order they are meant to be asked in.
 *
 * `docs_packages` needs nothing and answers with the arguments the next call
 * takes; `docs_entrypoint` and `docs_search` narrow to a name; `docs_symbol`
 * spends the length. That shape is the whole design: a model that has to guess
 * a package name to ask its first question will guess, and a wrong guess costs
 * a turn and reads exactly like a workspace that does not publish the thing.
 *
 * `docs_gaps` is the one that is not for using the library. It is for the person
 * maintaining it, and it lives here rather than in a lint rule because the
 * reading that ranks it is the same reading, and an agent that has just been
 * told a name is undocumented is the agent best placed to write the paragraph.
 */
export const HELP_TOOLS: readonly Tool<Help>[] = [packages, entrypoint, symbol, search, gaps];

export const SERVER_NAME = 'variance-authority-help';
export const SERVER_VERSION = '0.0.0';

/** What a server answers with: these five tools, over one workspace's reading. */
export const HELP: Served<Help> = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  tools: HELP_TOOLS,
};

export { entrypoint, gaps, packages, search, symbol };
export { audience, block, importing, line, reach } from './tools/format.js';
export { entriesNamed, openingOf, packageOf, specifierOf } from './tools/find.js';
