/**
 * `@variance-authority/mcp` — observed evidence, exposed to an agent.
 *
 * The chain the rest of this repository builds ends at a sentence: a cause, a
 * place, and a file. This package is what puts that sentence somewhere an agent
 * can reach it *after the fact*, from a different process, without access to
 * whatever was in scope when the change was sensed.
 *
 * Two concerns, two entrypoints, and the split is load-bearing:
 *
 * - `mcp/tools` — the answers, as pure functions from a report to text. Testable
 *   without speaking a protocol, which is the only way the question that matters
 *   ("does this help an agent fix it?") stays cheap to ask.
 * - `mcp/protocol` — MCP framing, as a pure function from a request to a
 *   response. Also pure, and separately exercisable, and generic in what it
 *   serves: a request, a subject, and a set of tools that read that subject.
 *   `REPORTS` is the set this package ships; a server over some other subject
 *   passes its own and reuses every line of the framing.
 *
 * `server.ts` is the stdio plumbing left over once those two are removed, and it
 * deliberately contains no decisions.
 *
 * What a producer *wrote* is not here. The report format is
 * `@variance-authority/report`, because the CLI writes it, a PR comment renders
 * it and these tools read it — and a format owned by one reader bends towards
 * that reader.
 */

export {
  NO_ARGS,
  SOURCE_TEST_TOOLS,
  TOOLS,
  sourceTestToolByName,
  stringArg,
  toolByName,
} from './tools.js';
export type { Served, Tool } from './tools.js';

export {
  REPORTS,
  SOURCE_TESTS,
  handle,
  createLineReader,
  PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_VERSION,
} from './protocol.js';
export type { JsonRpcRequest, JsonRpcResponse } from './protocol.js';

export { serve, serveReportFile } from './server.js';
export type { ReportFileOptions, ServerOptions } from './server.js';
