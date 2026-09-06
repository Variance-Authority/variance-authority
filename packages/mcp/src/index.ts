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
  EYES_TOOLS,
  OBSERVABILITY_TOOLS,
  PRESENTATION_TOOLS,
  SCENARIO_TOOLS,
  SOURCE_TEST_TOOLS,
  TOOLS,
  VANTAGE_TOOLS,
  eyesToolByName,
  observabilityToolByName,
  presentationToolByName,
  scenarioToolByName,
  sourceTestToolByName,
  stringArg,
  toolByName,
  vantageToolByName,
  diffState,
} from './tools.js';
export type { Served, StateDifference, Tool, ToolInvocation } from './tools.js';
export { locateSubjects, tokensOf, FIELD_WEIGHTS } from './tools/locate.js';
export type { Located, LocateHit, LocateMatch, LocateField } from './tools/locate.js';

export {
  EYES,
  OBSERVABILITY,
  PRESENTATIONS,
  REPORTS,
  SCENARIOS,
  SOURCE_TESTS,
  VANTAGE,
  handle,
  createLineReader,
  PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_VERSION,
} from './protocol.js';
export type { JsonRpcRequest, JsonRpcResponse } from './protocol.js';
export type { ObservabilitySubject } from './observability-subject.js';

export { serve, serveEyesArchive, serveReportFile, serveVantage } from './server.js';
export type { ReportFileOptions, ServerOptions, ServedVantage } from './server.js';
