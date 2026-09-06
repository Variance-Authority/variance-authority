import { AGENT, AGENT_VERSION, acquire, declared, type InstalledAgent } from './page-agent.js';

/**
 * The bundle's entry point, and the only module here with a side effect.
 *
 * Kept apart from `page-agent.ts` so the Node half can import the request types
 * and the function without writing to a `globalThis` that belongs to a process
 * with no page in it.
 */
(globalThis as unknown as Record<string, InstalledAgent>)[AGENT] = {
  acquire,
  version: AGENT_VERSION,
  declared,
};
