// compass: variance-authority/report
import type { JsonRpcResponse } from './framing.js';

/** What each refused call's tool threw, kept beside the response that says it. */
const thrown = new WeakMap<JsonRpcResponse, unknown>();

/** Keeps what the tool threw beside the refusal that carries its message. */
export function keepThrown(refused: JsonRpcResponse, error: unknown): void {
  thrown.set(refused, error);
}

/**
 * What the tool threw that `response` refuses with, or undefined for a response
 * no tool threw. The wire carries only the message; a host that tells one kind
 * of throw from another — a thrown answer from a refusal — reads the value here.
 */
export function thrownBy(response: JsonRpcResponse): unknown {
  return thrown.get(response);
}
