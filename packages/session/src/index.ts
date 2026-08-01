/**
 * `@variance-authority/session` — run many subjects in one standing world.
 *
 * The saving comes from not tearing anything down between subjects: no fresh
 * JSDOM per file, no browser per story, no Storybook reload, no re-parsing the
 * design system's stylesheet. The risk that buys is cross-pollution, so every
 * subject is bracketed by a cheap shared-state probe and its reads are derived
 * from its own capture — turning "these tests are flaky in CI" into "`story:card`
 * is order-dependent; `story:button` wrote `sheet:<style:3>`, which `story:card`
 * matched via `.btn`."
 */

export { createSession, Session } from './session.js';
export type { SessionOptions, SubjectRun, Finding, SessionStats } from './session.js';

export { probe, diffProbes, SheetRegistry } from './state.js';
export type { StateKey, StateProbe, StateDelta, ProbeOptions } from './state.js';

export { readsOf } from './reads.js';
export type { ReadSet } from './reads.js';
