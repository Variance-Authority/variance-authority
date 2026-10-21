import { afterEach, describe, expect, it, vi } from 'vitest';
import { currentSession, nextSession } from './session.js';

/** React's `cache` as a server renders it: one value per request in progress, none outside one. */
let inRequest: Map<Function, unknown> | undefined;
vi.mock('react', () => ({
  cache: <T>(fn: () => T) => (): T => {
    if (inRequest === undefined) return fn();
    if (!inRequest.has(fn)) inRequest.set(fn, fn());
    return inRequest.get(fn) as T;
  },
}));
const { requestSessions } = await import('./react.js');

afterEach(() => {
  inRequest = undefined;
  nextSession();
});

describe('requestSessions', () => {
  it('makes the request in progress the session, a new one for every request', () => {
    const stop = requestSessions();
    inRequest = new Map();
    const first = currentSession();
    expect(currentSession()).toBe(first);
    inRequest = new Map();
    expect(currentSession()).not.toBe(first);
    stop();
  });

  it('leaves the fallback session to answer outside a request, and after it is stopped', () => {
    const fallback = currentSession();
    const stop = requestSessions();
    expect(currentSession()).toBe(fallback);
    inRequest = new Map();
    stop();
    expect(currentSession()).toBe(fallback);
  });
});
