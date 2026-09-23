import type { Served, Tool } from '@variance-authority/mcp/tools';
import type { Help } from '@variance-authority/package/help';
import { workspaceGeneration } from './read.js';
import { entrypoint } from './tools/entrypoint.js';
import { gaps } from './tools/gaps.js';
import { packages } from './tools/packages.js';
import { search } from './tools/search.js';
import { symbol } from './tools/symbol.js';
import { uses } from './tools/uses.js';

/**
 * The six questions, and the order they are meant to be asked in.
 *
 * `docs_packages` needs nothing and answers with the arguments the next call
 * takes; `docs_entrypoint` and `docs_search` narrow to a name; `docs_symbol`
 * spends the length. That shape is the whole design: a model that has to guess
 * a package name to ask its first question will guess, and a wrong guess costs
 * a turn and reads exactly like a workspace that does not publish the thing.
 *
 * `docs_uses` follows `docs_symbol` because it is the other half of one
 * question. A signature says what a name is *supposed* to be; where the
 * repository already writes it says what using it actually looks like here, and
 * the two are separate tools rather than one long answer because a reader who
 * knows the API and wants the local convention should not have to buy the
 * signature again to get it.
 *
 * `docs_gaps` is the one that is not for using the library. It is for the person
 * maintaining it, and it lives here rather than in a lint rule because the
 * reading that ranks it is the same reading, and an agent that has just been
 * told a name is undocumented is the agent best placed to write the paragraph.
 */
function dated(tool: Tool<Help>): Tool<Help> {
  return {
    ...tool,
    run(subject, input, invocation) {
      const answer = tool.run(subject, input, invocation);
      const at = workspaceGeneration(subject);
      return at === undefined ? answer : `${answer}\n\nSource snapshot generated ${at}.`;
    },
  };
}

/** The source-orientation tools shared by shell dispatch and the server. */
export const HELP_TOOLS: readonly Tool<Help>[] =
  [packages, entrypoint, symbol, uses, search, gaps];

const DATED_HELP_TOOLS = HELP_TOOLS.map(dated);

export const SERVER_NAME = 'variance-authority-help';
export const SERVER_VERSION = '0.0.0';

/** What a server answers with: these six tools, over one workspace's reading. */
export const HELP: Served<Help> = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  tools: DATED_HELP_TOOLS,
};

export { entrypoint, gaps, packages, search, symbol, uses };
export { answerSearch, searchIndexOf } from './tools/search.js';
export type {
  ExportedMatch,
  InArea,
  Matches,
  PublishedMatch,
  SearchAnswer,
  SearchArea,
  SearchQuestion,
} from './tools/search-answer.js';
export { searchNames } from './tools/search-answer.js';
export type { Help };
export { audience, block, importing, line, reach, said } from './tools/format.js';
export { sharedSegments } from './tools/uses.js';
export { doorOf, entriesNamed, isPackage, openingOf, packageOf, specifierOf, unfound } from './tools/find.js';
