import type { RunReport } from '@variance-authority/report';

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
 * sentence is about a report. It defaults to `RunReport` so the nine tools this
 * package ships say nothing about it.
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
  run(subject: Subject, input: Readonly<Record<string, unknown>>): string;
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
}

export const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false } as const;

export function stringArg(input: Readonly<Record<string, unknown>>, name: string): string {
  const value = input[name];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`\`${name}\` is required and must be a non-empty string`);
  }
  return value;
}
