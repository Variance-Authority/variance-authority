/**
 * The package's main entry: whose state a frame reads, and the opt-in
 * isolation of what no module owns — the environment, global properties,
 * timers and event listeners.
 */

export { addSessionSource, currentSession, nextSession } from './session.js';
export { type SessionSource } from './realm.js';
export { isolateEnv, isolateGlobals } from './globals.js';
export { isolateListeners, type IsolateListenersOptions, type LeftListener } from './listeners.js';
export { perSession, type PerSessionOptions } from './per-session.js';
export { isolateTimers } from './timers.js';
