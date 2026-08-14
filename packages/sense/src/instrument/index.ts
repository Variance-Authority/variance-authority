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
 * ## The runtime is a global, and its absence is not a crash
 *
 * The emitted header resolves `globalThis.__VA__` on first use and falls back to a
 * private array when nothing installed it. Instrumented code therefore runs
 * correctly with no runtime at all, which is exactly what differential execution
 * needs: the same file, the same results, with and without.
 *
 * ## A probe survives leaving its realm
 *
 * Every call site is guarded by `typeof`, and that is not defensive padding —
 * differential execution over this repository found it. `page.evaluate(fn)`,
 * `new Function(fn.toString())` and a worker built from a stringified closure all
 * ship a function's *source* into a realm where this module's scope does not
 * exist, and an unguarded `__va(7)` there is a `ReferenceError` that appears only
 * in instrumented builds. Guarded, it evaluates to `false` and records nothing,
 * which is also the correct answer: that execution happened somewhere this index
 * does not reach, and [spec 0028](../../../../docs/specs/0028-the-instrument.md)
 * already says a browser needs a different transport rather than a different
 * instrument.
 */

import { parseSync } from 'oxc-parser';
import { walkBlocks, type Block, type BlockKind, type Edit } from './blocks.js';

export type { Block, BlockKind, Edit };

export interface Instrumented {
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

  const walked = walkBlocks(parsed.program, PROBES);
  const header = runtime(id, walked.blocks.length);

  const edits = [...walked.edits, { at: walked.prologue, text: header }];
  // Stable by construction: `Array.prototype.sort` keeps insertion order for equal
  // keys, and closing braces are emitted after the subtree that opened them, so an
  // inner `}` lands in front of an outer one at the same offset.
  const ordered = edits.sort((left, right) => left.at - right.at);

  return { code: splice(source, ordered), blocks: walked.blocks };
}

/**
 * Every call site tests for its own runtime first.
 *
 * `typeof` is the operator that does it, and it is the only one that can: it is
 * the sole expression in the language that names an identifier without requiring
 * it to resolve. In this module `__va` is a hoisted declaration, so the guard is
 * a context-slot load and a comparison against an interned string. In a page that
 * received this function as *text*, it is the difference between recording nothing
 * and throwing `ReferenceError`.
 *
 * `around` falls back to an identity arrow rather than a second global, because a
 * second global would need a guard of its own. The arrow is only ever constructed
 * in the realm that has no runtime.
 */
const PROBES = {
  hit: (ordinal: number) => `typeof __va==="function"&&__va(${ordinal})`,
  around: (ordinal: number) =>
    [`(typeof __vaR==="function"?__vaR:(v)=>v)(`, `,${ordinal})`] as const,
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
    `function __va(i){(__va.c??=globalThis.__VA__?.(${module},${count})??new Uint32Array(${count}))[i]++}` +
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
