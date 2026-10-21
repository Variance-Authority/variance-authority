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

const storage = new AsyncLocalStorage<object>();
addSessionSource(() => storage.getStore());

/**
 * Run `fn` in a new session: every module-level variable it reads, and every
 * callback and promise it starts, starts from its initial value and keeps its
 * own writes.
 */
export function isolated<T>(fn: () => T): T {
  return storage.run({}, fn);
}
