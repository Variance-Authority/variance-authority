import { serveReportFile } from '@variance-authority/mcp';
import type { Config } from '../config.js';

/**
 * `variance serve` — the MCP surface, which is wiring and nothing else.
 *
 * The emptiness of this file is the design. Everything an agent can ask lives in
 * `@variance-authority/mcp`: the tools are pure functions from a report to text,
 * the protocol is a pure function from a request to a response, and the transport
 * is stream plumbing with no decisions in it. If any of that were duplicated here
 * to make the command "do more", the two copies would answer differently and the
 * agent's answer would be the one nobody tested.
 *
 * **There is no option to make the server observe anything.** Every capability
 * this command could plausibly grow — re-run on demand, render a subject, refresh
 * a baseline — is work that belongs to the run, on the machine the run is pinned
 * to. A server that could render would render *here*, wherever here is, and
 * quietly answer questions about a machine that is not the one under test.
 *
 * What it does do is reload: `serveReportFile` re-reads the file on each request,
 * so an agent that fixes something, re-runs, and asks again is answered from the
 * new report rather than from the one loaded at boot. A stale report is how an
 * agent ends up confidently reporting a regression it has already fixed.
 */

export interface ServeOptions {
  /** The report to answer from. Defaults to the config's. */
  readonly report?: string;
}

/** Returns the stop function. The caller owns the process lifetime, not this. */
export async function serve(config: Config, options: ServeOptions = {}): Promise<() => void> {
  return serveReportFile(options.report ?? config.report);
}
