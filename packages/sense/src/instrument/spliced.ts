/**
 * What a block is, and the addon's answer for one module.
 *
 * One rule generates the whole set: **a block is a region with exactly one arrival
 * condition**, and a probe is placed only where control can diverge. Entering a
 * `try` block is implied by entering the region around it, so it gets nothing;
 * entering its `catch` is not, so it gets a probe. A loop body may run zero times.
 * The code after an `if` is not implied by the code before it, because a branch may
 * have left. That test — *does reaching here follow from reaching the enclosing
 * region* — is the whole of the design, and it is why this is not statement
 * coverage under another name.
 *
 * The descent that applies the rule is the addon's,
 * [`instrument_walk.rs`](../../native/src/instrument_walk.rs), and there is no
 * other. What stays here is what a caller has to understand: the vocabulary a
 * report is written in, and the columns the addon answers in. The tree never
 * crosses into JavaScript, which is most of what a module used to cost to
 * instrument; what crosses is the instrumented text and one column per block
 * field.
 *
 * ## What is deliberately not a decision
 *
 * Ternaries, `&&`, `||`, `??` and `?.` belong to the region that contains them
 * ([spec 0028](../../../../docs/specs/0028-the-instrument.md)). For
 * `if (order.isPremium && order.total > 100)` the fact worth recording is which
 * branch ran, not which operand short-circuited, and a change to either operand
 * still reaches every test that evaluated the condition — through the region the
 * condition sits in. They are deliberately not taken first.
 */

import { native, nativeRefusal } from '../addon.js';

/**
 * How much of the rule is applied.
 *
 * `presence` is the rule as stated above: every region with its own arrival
 * condition. `entries` keeps only the regions control arrives at from outside
 * the text — the module and each function — and lets every decision inside a
 * function belong to the function. Both walks number, name and digest the
 * regions they keep the same way, so a function has the same address under
 * either; what differs is how many regions there are and how much a probe set
 * costs to carry.
 */
export type InstrumentMode = 'presence' | 'entries';

/** What kind of region a probe stands in front of. */
export type BlockKind =
  | 'module'
  | 'function'
  | 'branch'
  | 'continuation'
  | 'resume'
  | 'loop'
  | 'case'
  | 'handler';

/**
 * One observed region.
 *
 * `name` and `path` are the two halves of identity that survive an edit above them;
 * `start` and `end` are offsets into the *original* source, which is what a diff
 * hunk lands on. A synthesized region — the `else` of a bare `if`, a `default`
 * nobody wrote — has no source, so its two offsets are equal. `owner` is the
 * nearest arrival region containing this one. It is absent only for the module
 * root, so widening from a changed decision to the precondition that governed it
 * never has to reconstruct containment from overlapping source spans.
 */
export interface Block {
  readonly ordinal: number;
  readonly kind: BlockKind;
  /** Ordinal of the enclosing arrival region; absent only on the module root. */
  readonly owner?: number;
  /** Identity of this region's own source, excluding the bodies its child regions own. */
  readonly digest: string;
  /** Declaration name path: `Cart/render/anon#0`, `applyTier/reduce.arg0`. */
  readonly name: string;
  /** Structural path inside that declaration: `if#0/else`, `switch#1/case#2`. */
  readonly path: string;
  readonly start: number;
  readonly end: number;
}

export interface Spliced {
  /** The source with every probe in place, and no header. */
  readonly code: string;
  /** Where the header goes in `code`: after the prologue and every probe in front of it. */
  readonly headerAt: number;
  /** Identity of the source the offsets are into. */
  readonly sourceDigest: string;
  readonly blocks: readonly Block[];
}

/** The addon's answer: one column per block field, in ordinal order. */
export interface NativeInstrumented {
  readonly code: string;
  readonly headerAt: number;
  readonly sourceDigest: string;
  /** Positions in {@link KINDS}. */
  readonly kinds: Uint8Array;
  /** `0xffffffff` on the module root, which has no owner. */
  readonly owners: Uint32Array;
  readonly starts: Uint32Array;
  readonly ends: Uint32Array;
  readonly names: readonly string[];
  readonly paths: readonly string[];
  readonly digests: readonly string[];
}

/** The addon numbers kinds in this order; `instrument_walk.rs` declares the same. */
const KINDS: readonly BlockKind[] = [
  'module',
  'function',
  'branch',
  'continuation',
  'resume',
  'loop',
  'case',
  'handler',
];

const NONE = 0xffffffff;

/** ES2024, on every Node this package supports and in no `lib` it compiles against. */
type WellFormed = string & { isWellFormed(): boolean };

/**
 * The addon's walk, or nothing when the source cannot be instrumented.
 *
 * Two sources cannot: one that does not parse, and one holding a lone
 * surrogate. The second never crosses, because the boundary would replace it
 * and every offset after it would describe a different string. Neither is a
 * guess, and both leave the module uninstrumented.
 *
 * No addon is an error rather than an uninstrumented module: every module would
 * be one, and a run that records nothing would look like a run in which nothing
 * ran. The refusal the loader kept names the package or the `dlopen` message.
 *
 * A walk that panics is an error too, and names the file it panicked on: the
 * addon returns the panic instead of aborting, so the test file that loaded
 * this module fails and the worker running it goes on to the next.
 */
export function spliced(source: string, file: string, mode: InstrumentMode): Spliced | undefined {
  const addon = native();
  if (addon === undefined) {
    throw new Error(`instrument: the native addon is required and did not load: ${nativeRefusal()}`);
  }
  if (!(source as WellFormed).isWellFormed()) return undefined;

  let answer: ReturnType<typeof addon.instrument>;
  try {
    answer = addon.instrument(source, file, mode === 'entries');
  } catch (error) {
    throw new Error(`instrument: the native walk failed on ${file}: ${(error as Error).message}`, { cause: error });
  }
  if (answer === null) return undefined;

  const blocks: Block[] = [];
  for (let ordinal = 0; ordinal < answer.starts.length; ordinal++) {
    const owner = answer.owners[ordinal]!;
    blocks.push({
      ordinal,
      kind: KINDS[answer.kinds[ordinal]!]!,
      ...(owner === NONE ? {} : { owner }),
      digest: answer.digests[ordinal]!,
      name: answer.names[ordinal]!,
      path: answer.paths[ordinal]!,
      start: answer.starts[ordinal]!,
      end: answer.ends[ordinal]!,
    });
  }

  return {
    code: answer.code,
    headerAt: answer.headerAt,
    sourceDigest: answer.sourceDigest,
    blocks,
  };
}
