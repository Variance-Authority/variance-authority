import type { RunReport } from '@variance-authority/report';
import type { Tree } from './tree.js';

/**
 * The contract every tool implements, and the untyped boundary it sits behind.
 *
 * Its own module because every tool imports it and it imports no tool: an
 * interface that lives in the registry beside the list of tools makes each tool
 * depend on all the others, and nothing about that dependency is visible until
 * something loads in the wrong order.
 *
 * The subject is a type parameter rather than `RunReport`, because a tool is a
 * pure function from *something already read* to text, and nothing in that
 * sentence is about a report. It defaults to `RunReport` so the report tools
 * this package ships say nothing about it.
 *
 * `stringArg` is here for the same reason it exists at all. A tool is called with
 * whatever JSON a model produced, so `input` is `unknown` all the way down, and
 * the first thing any tool does with an argument is refuse it or narrow it. That
 * refusal is part of the contract, not a detail of whichever tool refuses first.
 */

export interface Tool<Subject = RunReport> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  run(
    subject: Subject,
    input: Readonly<Record<string, unknown>>,
    invocation?: ToolInvocation<Subject>,
  ): string;

  /**
   * Whether this call needs the source tree read before it runs.
   *
   * Asked of the tool rather than worked out by the host, because the host is
   * transport and the answer is about arguments. Reading the tree is a walk of
   * the repository, and a tool list where every call paid for one would tax
   * every question to serve the few that take a path — so `variance_locate`
   * says yes exactly when a start point was given, and no otherwise.
   *
   * Absent means never, which is what almost every tool here means.
   */
  wants?(input: Readonly<Record<string, unknown>>): boolean;
}

/** What a host has already read, handed to a tool that cannot read anything itself. */
export interface ToolInvocation<Subject> {
  /** State held for exactly one previous invocation, by whatever is holding it. */
  readonly previous?: Subject;
  /**
   * The source tree, where the host could read one and the call asked for it.
   *
   * A tool is a pure function from something already read, and a path is a fact
   * about a tree that somebody has to walk. So the walk happens out here, ahead
   * of the call, and arrives as a value like the report does. Absent means no
   * tree was read, and a question that needed one is refused rather than
   * answered from something that is not a tree.
   */
  readonly tree?: Tree;
}

/**
 * A set of tools, and what the server answering with them calls itself.
 *
 * The subject is a parameter because the protocol has no opinion about it. A run
 * report is one subject; a workspace's published API is another, and the framing
 * between a JSON-RPC line and a tool's text is identical for both. What differs
 * is the list and the name, and that is exactly what this holds.
 */
export interface Served<Subject = RunReport> {
  readonly name: string;
  readonly version: string;
  readonly tools: readonly Tool<Subject>[];
  /**
   * What a client puts in front of the model before it has called anything.
   *
   * A tool list says what each tool answers and cannot say when to reach for
   * one, and there is a class of server where that gap is the whole product: a
   * watcher nobody attached a run to lists tools about a run that does not
   * exist, reads as broken, and is never called again. So this takes the
   * subject — the one thing a set of tools cannot see at handshake time — and
   * anything it needs to say about **setup** goes here rather than into a tool
   * nobody has a reason to call yet.
   *
   * Omitted where a tool list is self-explanatory, which is the ordinary case:
   * a report on disk is already there, and nothing has to be arranged.
   */
  readonly instructions?: (subject: Subject) => string;
}

export const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false } as const;

export function stringArg(input: Readonly<Record<string, unknown>>, name: string): string {
  const value = input[name];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`\`${name}\` is required and must be a non-empty string`);
  }
  return value;
}
