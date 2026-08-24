/**
 * `@variance-authority/sense/instrument` — the transform that records the path.
 *
 * A pure function of a string: `instrument(source, id)` parses, decides where the
 * execution boundaries are ([`blocks.ts`](./blocks.ts)), and splices a recording
 * call in front of each one. No disk, no runner, no index. That is deliberate —
 * this is the only part of
 * [spec 0027](../../../../docs/specs/0027-a-test-is-selected-by-what-it-executed.md)
 * that *manufactures* an artifact, so it is the first thing to build and the
 * cheapest thing to refute.
 *
 * ## Lines are preserved exactly
 *
 * Every insertion is single-line — no emitted text contains a newline — so a stack
 * trace, a `//# sourceMappingURL` further down the chain and a coverage tool
 * reading the same file all still agree about line numbers. Columns shift, which
 * is what a source map would exist to fix, and which nothing yet needs.
 *
 * ## The runtime is a required global
 *
 * The emitted header resolves `globalThis.__VA__` on first use. An instrumented
 * module with no collector throws at its first probe, making an incomplete runner
 * configuration visible rather than silently dropping evidence.
 *
 * ## A probe stays in its instrumented realm
 *
 * Every inserted site calls the declarations in the generated module directly.
 * Re-evaluating an instrumented function's source in another realm loses those
 * declarations and throws, exposing that configuration error at its first probe.
 */

// TODO: add maintained Jest and Playwright integrations; browser execution also needs transport.

import { digestString } from '@variance-authority/core';
import { parseSync } from 'oxc-parser';
import { walkBlocks, type Block, type BlockKind, type Edit } from './blocks.js';

export type { Block, BlockKind, Edit };

/** Changes whenever two instrumented block universes must not share observations. */
export const INSTRUMENTATION_ID = 'sense:instrument/presence-v2';

export interface Instrumented {
  /** Identity of the exact source string whose offsets and blocks follow. */
  readonly sourceDigest: string;
  /** Identity of the probe recipe; unequal recipes never share observations. */
  readonly instrumentation: string;
  /** The source with probes spliced in. Same line count, same line breaks. */
  readonly code: string;
  /** Every region, in ordinal order. `blocks[0]` is always the module itself. */
  readonly blocks: readonly Block[];
}

/**
 * Instrument one module.
 *
 * `undefined` when the source could not be parsed, and that is the whole reason it
 * is not an exception: a file this cannot read is a file whose blocks are unknown,
 * and [ADR-0008](../../../../docs/context/adr/0008-per-profile-expectations.md)
 * says the honest report is *not instrumented*, never *not executed*. A caller
 * that swallowed a throw here would produce the second.
 */
export function instrument(source: string, id: string): Instrumented | undefined {
  const parsed = parseSync(id, source);

  // A recovered tree has holes in it, and a probe spliced against a hole produces
  // a file that no longer compiles. Refusing costs one uninstrumented module.
  if (parsed.errors.length > 0) return undefined;

  const walked = walkBlocks(parsed.program, source, PROBES);
  const header = runtime(id, walked.blocks.length);

  const edits = [...walked.edits, { at: walked.prologue, text: header }];
  // Stable by construction: `Array.prototype.sort` keeps insertion order for equal
  // keys, and closing braces are emitted after the subtree that opened them, so an
  // inner `}` lands in front of an outer one at the same offset.
  const ordered = edits.sort((left, right) => left.at - right.at);

  return {
    code: splice(source, ordered),
    sourceDigest: digestString(source),
    instrumentation: INSTRUMENTATION_ID,
    blocks: walked.blocks,
  };
}

/**
 * Every call site invokes the generated runtime directly.
 */
const PROBES = {
  hit: (ordinal: number) => `__va(${ordinal})`,
  around: (ordinal: number) => [`__vaR(`, `,${ordinal})`] as const,
};

/**
 * The two hoisted declarations every instrumented module carries.
 *
 * Function declarations rather than a `const`, because a circular import can call
 * back into this module before its own top level has run — a binding in the
 * temporal dead zone would turn that into a `ReferenceError` that only appears in
 * instrumented builds, which is the worst kind of difference to chase.
 *
 * The module's own probe fires here, at the end of the prologue rather than at
 * offset 0, so it sits below anything vitest hoisted.
 */
function runtime(id: string, count: number): string {
  const module = JSON.stringify(id);

  return (
    `function __va(i){const r=globalThis.__VA__;if(__va.c===undefined||__va.r!==r){__va.r=r;__va.c=globalThis.__VA__(${module},${count})}__va.c[i]++}` +
    `function __vaR(v,i){__va(i);return v}` +
    `__va(0);`
  );
}

function splice(source: string, edits: readonly Edit[]): string {
  const parts: string[] = [];
  let read = 0;

  for (const edit of edits) {
    parts.push(source.slice(read, edit.at), edit.text);
    read = edit.at;
  }
  parts.push(source.slice(read));

  return parts.join('');
}
