/**
 * Sessions in Node: one per `isolated` call, carried through every `await`.
 *
 * ```ts
 * import { isolated } from '@variance-authority/isolator/node';
 * server.on('request', (req, res) => isolated(() => handle(req, res)));
 * ```
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import { addSessionSource } from './session.js';

const STORAGE = Symbol.for('@variance-authority/isolator/node');
const ISOLATING = Symbol.for('@variance-authority/isolator/node/isolating');

type Host = typeof globalThis & { [STORAGE]?: AsyncLocalStorage<object> };

/**
 * One storage for every copy of this module, registered once: a reset module
 * registry or a dual CommonJS/ES resolution loads this file twice, and a
 * session one copy starts inside a session of the other's is the one in force.
 */
const storage = ((): AsyncLocalStorage<object> => {
  const host = globalThis as Host;
  if (host[STORAGE] !== undefined) return host[STORAGE];
  const created = (host[STORAGE] = new AsyncLocalStorage<object>());
  addSessionSource(() => created.getStore());
  return created;
})();

/**
 * Run `fn` in a new session: every module-level variable it reads, and every
 * callback and promise it starts, starts from its initial value and keeps its
 * own writes.
 */
export function isolated<T>(fn: () => T): T {
  return storage.run({}, fn);
}

/** A test registrar such as Jest's `test.concurrent`, with its variants hung on it. */
export type Registrar = ((name: unknown, fn?: unknown, ...rest: unknown[]) => unknown) & { [variant: string | symbol]: unknown };

/**
 * Run every concurrent test in its own session. Call it from a setup file,
 * with the runner's `test`: `isolateConcurrentTests(test)`.
 *
 * A concurrent test runs no `beforeEach`, and its body interleaves with the
 * others', so no reset between tests can separate them: each body starts
 * through {@link isolated} instead. The variants hung on `test.concurrent` —
 * `only`, `skip`, `failing`, `each` — are wrapped too. In Jest `it` is the
 * same object as `test`.
 */
export function isolateConcurrentTests(test: { concurrent: Registrar }): void {
  if (test.concurrent[ISOLATING] !== true) test.concurrent = isolating(test.concurrent);
}

function isolating(register: Registrar): Registrar {
  const wrapped = ((name: unknown, fn?: unknown, ...rest: unknown[]) =>
    register(name, typeof fn === 'function' ? (...args: unknown[]) => isolated(() => fn(...args)) : fn, ...rest)) as Registrar;
  for (const [variant, value] of Object.entries(register)) {
    if (typeof value !== 'function') wrapped[variant] = value;
    else if (variant === 'each') wrapped[variant] = (...table: unknown[]) => isolating(value(...table) as Registrar);
    else wrapped[variant] = isolating(value as Registrar);
  }
  wrapped[ISOLATING] = true;
  return wrapped;
}
