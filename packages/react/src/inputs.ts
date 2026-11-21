import type { Fiber } from './fiber.js';

/**
 * The inputs a render reads, as React records them on a fiber: its props, and
 * the contexts it subscribed to. Every reader here takes them from this file —
 * `wiring.ts` the names, `holding.ts` a digest of each value, `renders.ts` the
 * values across one render — so what counts as an input is decided once.
 */

/** Bounds the context list walk against a cycle in `next`. */
const MAX_CONTEXTS = 256;

/** One context a fiber read: the context object, its display name, and the value it read. */
export interface ContextRead {
  /** The context object itself, which tells apart two contexts that share a name. */
  readonly context: unknown;
  /** The context's display name, or `(anonymous)`: a subscription nobody named is still a subscription. */
  readonly name: string;
  readonly value: unknown;
}

/** The contexts `fiber` read at its last render, in the order it read them. */
export function contextReadsOf(fiber: Fiber): ContextRead[] {
  const reads: ContextRead[] = [];
  let link = fiber.dependencies?.firstContext;
  for (let seen = 0; seen < MAX_CONTEXTS && link; seen += 1, link = link.next) {
    const displayName = link.context?.displayName;
    const name = typeof displayName === 'string' && displayName !== '' ? displayName : '(anonymous)';
    reads.push({ context: link.context, name, value: link.memoizedValue });
  }
  return reads;
}

/**
 * The props that are inputs, in the order the props object holds them: every key but `children`.
 *
 * `children` *is* the subtree, new on every render of the parent, so counting
 * it would make every ancestor's inputs a function of every descendant's edit.
 * Symbol keys are skipped by `Object.keys` already, which is what keeps
 * `JSX_SOURCE` out without this file having to know it exists.
 */
export function inputPropNames(props: Readonly<Record<string, unknown>> | null | undefined): string[] {
  if (props === null || typeof props !== 'object') return [];
  return Object.keys(props).filter((name) => name !== 'children');
}
