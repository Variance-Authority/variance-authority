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
 * - `mcp/protocol` — the sets this package serves (`REPORTS` and its siblings),
 *   with the MCP framing re-exported beside them. The framing is a pure
 *   function from a request to a response, generic in what it serves: a
 *   request, a subject, and a set of tools that read that subject. A server
 *   over some other subject passes its own set and reuses every line of it.
 *
 * `server.ts` is the stdio plumbing left over once those two are removed, and it
 * deliberately contains no decisions. It reads only the framing until a server
 * is started, so importing a pure function from this root does not evaluate the
 * served sets or the readers behind them.
 *
 * What a producer *wrote* is not here. The report format is
 * `@variance-authority/report`, because the CLI writes it, a PR comment renders
 * it and these tools read it — and a format owned by one reader bends towards
 * that reader.
 */

export { locateSubjects, tokensOf, FIELD_WEIGHTS } from './tools/locate.js';
export type { Located, LocateHit, LocateMatch, LocateField } from './tools/locate.js';

export type { ObservabilitySubject } from './observability-subject.js';

export { readEyesRecord, RecordKeepsNoEyes } from './eyes-record.js';
export { serve, serveEyesRecord, serveReportFile, serveVantage } from './server.js';
export type { AskedAgain, ReportFileOptions, ServerOptions, ServedVantage } from './server.js';
