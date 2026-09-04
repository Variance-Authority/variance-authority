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
 *
 * ```
 * [confirmed] story:card
 *   cause:    story:toolbar (rendered by Button, Toolbar)
 *   via:      sheet:<style:0>
 *   evidence: re-running `story:card` in the same session produced a different
 *             render hash with no code change; `story:toolbar` wrote
 *             `sheet:<style:0>`, which this subject matched `.card`
 *   fix:      make `story:toolbar` clean up `sheet:<style:0>`, or scope it so it
 *             cannot reach `story:card`
 * ```
 *
 * A subject that is not finished when `mount` returns says so by returning a
 * promise; `run` awaits it and stays entirely synchronous when it does not. A
 * subject that renders nothing is refused rather than snapshotted, because an
 * empty container compares equal to every other empty container and would report
 * `unchanged` forever while showing nothing.
 *
 * One caller-side sharp edge: the subject container is the same element every
 * run, so a React caller must create one root per session and `root.render` per
 * subject. Calling `createRoot` per subject warns and leaks the previous root.
 *
 * **Requires a live DOM** and nothing else. It knows about React only through the
 * caller's `mount`, so a session runs whatever a caller can put on a page.
 */

// compass: variance-authority.stability

export { createSession, Session } from './session.js';
export type { SessionOptions, SubjectRun, Finding, SessionStats } from './session.js';

export { probe, diffProbes, SheetRegistry } from './state.js';
export type { StateKey, StateProbe, StateDelta, ProbeOptions } from './state.js';

export { readsOf } from './reads.js';
export type { ReadSet } from './reads.js';
