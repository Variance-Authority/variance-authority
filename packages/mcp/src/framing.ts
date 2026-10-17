// compass: variance-authority/report
import type { Served, Tool, ToolInvocation } from './tools/tool.js';

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

const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;

/**
 * Answer one request. `null` means "no response", which is not the same as an
 * empty one — a notification that gets answered is a protocol violation.
 *
 * `served` is required rather than defaulted to the report tools. A default would
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
  return answering(request, subject, served, invocation).response;
}

/**
 * A response, and what the tool threw when the response refuses a call. The
 * wire carries only the message; a server whose host tells one kind of throw
 * from another — a thrown answer from a refusal — needs the value itself.
 */
export interface Answering {
  readonly response: JsonRpcResponse | null;
  /** Present when a tool threw: what it threw. */
  readonly thrown?: { readonly value: unknown };
}

/** {@link handle}, with what a refusing tool threw beside its response. */
export function answering<Subject>(
  request: JsonRpcRequest,
  subject: () => Subject,
  served: Served<Subject>,
  invocation?: ToolInvocation<Subject>,
): Answering {
  if (request.id === undefined) return { response: null };
  const id = request.id;
  if (request.method === 'tools/call') return callTool(id, request.params ?? {}, subject, served.tools, invocation);
  return { response: respond(request.method, id, subject, served) };
}

function respond<Subject>(method: string, id: string | number, subject: () => Subject, served: Served<Subject>): JsonRpcResponse {
  switch (method) {
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

    default:
      return fail(id, METHOD_NOT_FOUND, `unknown method: ${method}`);
  }
}

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

/** The arguments a `tools/call` names, or nothing for any other request. */
export function askedInput(request: JsonRpcRequest): Readonly<Record<string, unknown>> | undefined {
  if (request.method !== 'tools/call') return undefined;
  const given = (request.params ?? {})['arguments'];
  return typeof given === 'object' && given !== null && !Array.isArray(given)
    ? (given as Readonly<Record<string, unknown>>)
    : undefined;
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
export function wantsTree<Subject>(
  request: JsonRpcRequest,
  served: Served<Subject>,
): boolean {
  if (request.method !== 'tools/call') return false;
  const params = request.params ?? {};
  const tool = served.tools.find((candidate) => candidate.name === params['name']);
  return tool?.wants?.((params['arguments'] ?? {}) as Record<string, unknown>) === true;
}

/**
 * Whether a call names a tool the server has, with every argument its schema
 * requires. A refusal of any other call is about the call, and no subject read
 * again could answer it.
 */
export function wellFormed<Subject>(request: JsonRpcRequest, served: Served<Subject>): boolean {
  const name = askedTool(request);
  const tool = name === undefined ? undefined : served.tools.find((candidate) => candidate.name === name);
  if (tool === undefined) return false;
  const given = askedInput(request) ?? {};
  const required = (tool.inputSchema as { readonly required?: readonly string[] }).required ?? [];
  return required.every((key) => given[key] !== undefined && given[key] !== null && given[key] !== '');
}

function callTool<Subject>(
  id: string | number,
  params: Readonly<Record<string, unknown>>,
  subject: () => Subject,
  tools: readonly Tool<Subject>[],
  invocation?: ToolInvocation<Subject>,
): Answering {
  const name = params['name'];
  if (typeof name !== 'string') return { response: fail(id, INVALID_PARAMS, 'tools/call requires a name') };

  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) return { response: fail(id, INVALID_PARAMS, `unknown tool: ${name}`) };

  try {
    const text = tool.run(
      subject(),
      (params['arguments'] ?? {}) as Record<string, unknown>,
      invocation,
    );
    return { response: ok(id, { content: [{ type: 'text', text }] }) };
  } catch (error) {
    // A tool failure is a *result* with `isError`, not a JSON-RPC error. The
    // distinction matters here: a transport error is invisible to the model,
    // while an error result is text it can read and correct from — and "unknown
    // subject; this run has: …" is precisely the kind of correction worth
    // handing back rather than swallowing.
    const refused = ok(id, {
      content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }],
      isError: true,
    });
    return { response: refused, thrown: { value: error } };
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
