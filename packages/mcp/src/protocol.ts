import type { EyesArchive } from '@variance-authority/eyes';
import type { PresentationReport } from '@variance-authority/presentation';
import type { RunReport } from '@variance-authority/report';
import type { ScenarioArchiveManifest } from '@variance-authority/scenario/archive';
import type { ExecutionIndex } from '@variance-authority/sense/test-selection';
import type { VantageState } from '@variance-authority/vantage';
import type { ObservabilitySubject } from './observability-subject.js';
import type { Served, Tool, ToolInvocation } from './tools/tool.js';
import {
  EYES_TOOLS,
  OBSERVABILITY_TOOLS,
  PRESENTATION_TOOLS,
  SCENARIO_TOOLS,
  SOURCE_TEST_TOOLS,
  TOOLS,
  VANTAGE_TOOLS,
} from './tools.js';
import { attaching } from './tools/vantage-lines.js';

/**
 * MCP over stdio, written out rather than depended on.
 *
 * The protocol is JSON-RPC 2.0 with newline-delimited framing and three methods
 * that matter. Writing it is roughly a hundred lines; depending on an SDK to
 * obtain those hundred lines costs a package, a version, and a transitive tree
 * in a repository whose `core` went to the trouble of implementing SHA-256 to
 * avoid depending on `node:crypto` (ADR-0006). The same judgement applies.
 *
 * The payoff is the same too: `handle` is a pure function from a request to a
 * response. No sockets, no streams, no process. Every behaviour below can be
 * asserted by calling it.
 */

export const PROTOCOL_VERSION = '2024-11-05';
export const SERVER_NAME = 'variance-authority';
export const SERVER_VERSION = '0.0.0';

export interface JsonRpcRequest {
  readonly jsonrpc: '2.0';
  /** Absent on a notification, which must not be answered. */
  readonly id?: string | number;
  readonly method: string;
  readonly params?: Readonly<Record<string, unknown>>;
}

export interface JsonRpcResponse {
  readonly jsonrpc: '2.0';
  readonly id: string | number;
  readonly result?: unknown;
  readonly error?: { readonly code: number; readonly message: string };
}

/** The visual-report tools this package ships, as the thing `handle` is handed. */
export const REPORTS: Served<RunReport> = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  tools: TOOLS,
  instructions: () =>
    'This connection reads a completed RunReport; it does not run or reconstruct the comparison. ' +
    'Produce one with `variance run` and a configured `report` path. ' +
    'Guide: https://variance-authority.dev/start-cli',
};

/** The MCP surface for agents asking which named tests exercise source. */
export const SOURCE_TESTS: Served<ExecutionIndex> = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  tools: SOURCE_TEST_TOOLS,
  instructions: () =>
    'This connection reads an ExecutionIndex with stable per-test identities. Sense ships the ' +
    'query and no producer for that index; a per-file test-selection snapshot cannot substitute. ' +
    'Guide: https://variance-authority.dev/reference/packages/sense',
};

/**
 * The MCP surface for an agent watching a suite that has not finished.
 *
 * Unlike retained served sets, this one answers about a run somebody still has
 * to start. An agent that is not told the variable at the handshake starts it
 * without one. What each tool answers is in its own description in `tools/list`,
 * so the instructions do not say it again.
 */
export const VANTAGE: Served<VantageState> = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  tools: VANTAGE_TOOLS,
  instructions: (state) =>
    [
      'This server watches a test run while it happens; it is not limited to visual tests. ' +
        'Start with `variance_self`.',
      '',
      attaching(state),
    ].join('\n'),
};

/** The MCP surface for synchronously captured test attention. */
export const EYES: Served<EyesArchive> = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  tools: EYES_TOOLS,
  instructions: () =>
    'This connection reads retained Eyes attention; it does not instrument a runner. Compose the ' +
    'RTL or Playwright adapter, author AAA phase markers, retain journals with their completion ' +
    'state under stable test ids, and install React observation before `react-dom` loads. ' +
    'Guide: https://variance-authority.dev/reference/packages/eyes',
};

/** The MCP surface for full presentation graphs held by their caller. */
export const PRESENTATIONS: Served<readonly PresentationReport[]> = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  tools: PRESENTATION_TOOLS,
  instructions: () =>
    'This connection reads full PresentationReport graphs. Acquire them from the live subject ' +
    'with `@variance-authority/presentation/playwright`; a durable presentation signal inside a ' +
    'RunReport is a different, smaller reading. Guide: https://variance-authority.dev/presentation',
};

/** The MCP surface for retained scenario executions. */
export const SCENARIOS: Served<readonly ScenarioArchiveManifest[]> = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  tools: SCENARIO_TOOLS,
  instructions: () =>
    'This connection reads retained scenario executions. Record host-produced semantic snapshots ' +
    'and authored Acts with `@variance-authority/scenario`, then use its archive entrypoint when ' +
    'the evidence must survive the process. ' +
    'Guide: https://variance-authority.dev/reference/packages/scenario',
};

/**
 * The MCP surface that exposes every supplied observability domain without
 * merging their evidence or inventing cross-domain identity.
 */
export const OBSERVABILITY: Served<ObservabilitySubject> = {
  name: SERVER_NAME,
  version: SERVER_VERSION,
  tools: OBSERVABILITY_TOOLS,
  instructions: () => [
    'This connection can expose visual reports, full presentation readings and durable signals, runtime journeys, ' +
      'live events, Eyes attention and retained scenarios. Start with `variance_observability` ' +
      'to learn which independent evidence domains were supplied.',
    '',
    'Unavailable evidence is not an empty measurement. Cross-domain answers join only on ' +
      'exact identities emitted by both producers. `variance_distill` reports distillation ' +
      'opportunities; it does not establish that a branch is safe to mock. When a domain is ' +
      'unavailable, `variance_observability` names its producer and integration guide.',
  ].join('\n'),
};

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

/**
 * Answer one request. `null` means "no response", which is not the same as an
 * empty one — a notification that gets answered is a protocol violation.
 *
 * `served` is required rather than defaulted to {@link REPORTS}. A default would
 * infer its subject from whatever the second argument returns and then answer it
 * with report tools, which is the class of mistake this file exists to make
 * impossible: a server that speaks fluently about the wrong thing.
 */
export function handle<Subject>(
  request: JsonRpcRequest,
  subject: () => Subject,
  served: Served<Subject>,
  invocation?: ToolInvocation<Subject>,
): JsonRpcResponse | null {
  if (request.id === undefined) return null;
  const id = request.id;

  switch (request.method) {
    case 'initialize':
      return ok(id, {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: { tools: {} },
        serverInfo: { name: served.name, version: served.version },
        // Read at the handshake rather than fixed at construction, because the
        // one thing worth saying here — the address a run reports to — is not
        // known until the listener has a port.
        ...(served.instructions === undefined
          ? {}
          : { instructions: served.instructions(subject()) }),
      });

    case 'ping':
      return ok(id, {});

    case 'tools/list':
      return ok(id, {
        tools: served.tools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      });

    case 'tools/call':
      return callTool(id, request.params ?? {}, subject, served.tools, invocation);

    default:
      return fail(id, METHOD_NOT_FOUND, `unknown method: ${request.method}`);
  }
}

/**
 * Whether answering this request needs the source tree read first.
 *
 * Decided here rather than in the transport, and by the tool rather than by
 * either: a host that sniffed arguments for a path would be making a decision,
 * and the transport is the one file in this package that makes none. Reading a
 * tree is a walk of the repository, so it is done for the calls that asked for
 * one and no others.
 */
/**
 * Which tool a request calls, where it calls one.
 *
 * The server knows this before it asks for a subject, and a host answering over
 * more than one subject needs it: reading a workspace to answer a question about
 * a report would make every question cost both.
 */
export function askedTool(request: JsonRpcRequest): string | undefined {
  if (request.method !== 'tools/call') return undefined;
  const name = (request.params ?? {})['name'];
  return typeof name === 'string' ? name : undefined;
}

export function wantsTree<Subject>(
  request: JsonRpcRequest,
  served: Served<Subject>,
): boolean {
  if (request.method !== 'tools/call') return false;
  const params = request.params ?? {};
  const tool = served.tools.find((candidate) => candidate.name === params['name']);
  return tool?.wants?.((params['arguments'] ?? {}) as Record<string, unknown>) === true;
}

function callTool<Subject>(
  id: string | number,
  params: Readonly<Record<string, unknown>>,
  subject: () => Subject,
  tools: readonly Tool<Subject>[],
  invocation?: ToolInvocation<Subject>,
): JsonRpcResponse {
  const name = params['name'];
  if (typeof name !== 'string') return fail(id, INVALID_PARAMS, 'tools/call requires a name');

  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) return fail(id, INVALID_PARAMS, `unknown tool: ${name}`);

  try {
    const text = tool.run(
      subject(),
      (params['arguments'] ?? {}) as Record<string, unknown>,
      invocation,
    );
    return ok(id, { content: [{ type: 'text', text }] });
  } catch (error) {
    // A tool failure is a *result* with `isError`, not a JSON-RPC error. The
    // distinction matters here: a transport error is invisible to the model,
    // while an error result is text it can read and correct from — and "unknown
    // subject; this run has: …" is precisely the kind of correction worth
    // handing back rather than swallowing.
    return ok(id, {
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    });
  }
}

function ok(id: string | number, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id, result };
}

function fail(id: string | number, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/**
 * Newline-delimited framing.
 *
 * Buffers partial lines because a stdio chunk boundary falls wherever the OS
 * puts it, not where a JSON value ends. Getting this wrong produces a parse
 * error under load and never in a test.
 */
export function createLineReader(onLine: (line: string) => void): (chunk: string) => void {
  let buffer = '';

  return (chunk: string): void => {
    buffer += chunk;

    let index = buffer.indexOf('\n');
    while (index !== -1) {
      const line = buffer.slice(0, index).trim();
      buffer = buffer.slice(index + 1);
      if (line !== '') onLine(line);
      index = buffer.indexOf('\n');
    }
  };
}
