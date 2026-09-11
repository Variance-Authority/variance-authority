/**
 * `@variance-authority/core` — the format, the rules, and the verdict model.
 *
 * This package is pure data in, pure data out: no DOM, no React, no I/O, no
 * async. That is enforced by its `tsconfig` (`lib: ES2022` only), so "the core
 * cannot peek at a live document" is a compile error rather than a convention
 * (ADR-0001). Collectors extract; core normalizes and adjudicates.
 *
 * Seven groups, each its own entrypoint, in the order an answer travels through
 * them:
 *
 * | entrypoint | what it holds |
 * |---|---|
 * | `core/format` | what a subject *is*: capture, snapshot, document, identity |
 * | `core/rules` | the versioned opinions: allowlist, cascade, canonicalization |
 * | `core/compare` | two snapshots become deltas — and no verdict |
 * | `core/attribute` | a position becomes a component becomes a file |
 * | `core/relate` | what reaches what: the graph a change is traversed over |
 * | `core/judge` | policy: verdicts, intent, the docket a reader is handed |
 * | `core/plan` | a composition as a value, and the identity derived from it |
 *
 * Every name lives in exactly one of them; nothing is reachable from two paths.
 * This entrypoint holds only what belongs to no group: the artifact a capture is
 * written to.
 */

export * from './artifact.js';
