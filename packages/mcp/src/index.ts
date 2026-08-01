/**
 * `@variance-authority/mcp` — the observation, exposed to an agent.
 *
 * The chain the rest of this repository builds ends at a sentence: a cause, a
 * place, and a file. This package is what puts that sentence somewhere an agent
 * can reach it *after the fact*, from a different process, without access to
 * whatever was in scope when the change was sensed.
 *
 * Three files, three concerns, and the split is load-bearing:
 *
 * - `report.ts` — the on-disk contract. A run writes it; the tools read it.
 *   Because it is a file, the run can happen on a pinned machine in CI and the
 *   questions can be asked on a laptop.
 * - `tools.ts` — the answers, as pure functions from a report to text. Testable
 *   without speaking a protocol, which is the only way the question that matters
 *   ("does this help an agent fix it?") stays cheap to ask.
 * - `protocol.ts` — MCP, as a pure function from a request to a response.
 *
 * `server.ts` is the stream plumbing left over once those three are removed, and
 * it deliberately contains no decisions.
 */

export type { RunReport, ObservationRecord, RegionRecord } from './report.js';
export { readRunReport, writeRunReport } from './report.js';

export { TOOLS, toolByName } from './tools.js';
export type { Tool } from './tools.js';

export {
  handle,
  createLineReader,
  PROTOCOL_VERSION,
  SERVER_NAME,
  SERVER_VERSION,
} from './protocol.js';
export type { JsonRpcRequest, JsonRpcResponse } from './protocol.js';

export { serve, serveReportFile } from './server.js';
export type { ServerOptions } from './server.js';
