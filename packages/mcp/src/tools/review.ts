import type { Tool } from './tool.js';

/**
 * A question about what review settled, and the one deployment route it is
 * answered from.
 *
 * The route and its query are the tool's to say rather than the host's to
 * know, for the reason `wants` is: the host is transport, and which window a
 * call names is a reading of its arguments. So a host reads every review tool
 * the same way — this route, this query, the share token — and a second
 * question about review is a second tool, never a second reader.
 */

/** What a host read from a review deployment for one call. */
export interface Reviewed {
  /** The deployment the answer was read from, as a reader should be told it. */
  readonly from: string;
}

export interface ReviewTool<Subject extends Reviewed = Reviewed> extends Tool<Subject> {
  /** The deployment route the subject is read from, with the share token. */
  readonly route: string;
  /**
   * The call's input, read once, as the query string the host sends to
   * `route`. Throws what the tool would refuse, before anything is fetched.
   */
  query(input: Readonly<Record<string, unknown>>): Readonly<Record<string, string | number | undefined>>;
}

/** A non-empty string argument, or absent. */
export function textOf(input: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = input[name];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value === '') throw new Error(`\`${name}\` must be a non-empty string`);
  return value;
}

export function count(n: number, noun: string): string {
  return `${String(n)} ${noun}${n === 1 ? '' : 's'}`;
}
