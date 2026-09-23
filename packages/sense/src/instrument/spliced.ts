/**
 * The probes spliced into one module, by either of two implementations.
 *
 * Both answer the same thing: the source with every probe in place, the
 * regions it records, and the offset the module header goes at. The header
 * itself is [`index.ts`](./index.ts)'s, written once for both, because its text
 * is the runtime's contract and one author is how it stays one contract.
 *
 * The JavaScript walk is the implementation of record. The native one is the
 * same walk in the addon, over the same oxc, and exists because the tree it
 * reads never has to cross into JavaScript: that crossing is most of what a
 * module costs to instrument, and a suite pays it once per module per worker.
 * It declines what it cannot answer identically — a source that does not
 * parse, a name it cannot spell the way JavaScript does — and `spliced.test.ts`
 * holds the two to byte equality over every source in the repository.
 */

import { native } from '../addon.js';
import { digestString } from '../digest.js';
import { parseSync, rawTransferSupported, type ParserOptions } from 'oxc-parser';
import {
  walkBlocks,
  type Block,
  type BlockKind,
  type Edit,
  type InstrumentMode,
} from './blocks.js';

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
 * The addon's walk, or nothing when there is no addon or it declined.
 *
 * A source with a lone surrogate never crosses: the boundary would replace it,
 * and every offset after it would describe a different string.
 */
export function splicedNatively(
  source: string,
  file: string,
  mode: InstrumentMode,
): Spliced | undefined {
  const addon = native();
  if (addon === undefined || !(source as WellFormed).isWellFormed()) return undefined;

  const answer = addon.instrument(source, file, mode === 'entries');
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

/**
 * How the parsed tree crosses out of the parser.
 *
 * oxc parses in Rust and then has to hand a tree back to JavaScript. By default
 * it serializes one to JSON and the package's own wrapper parses that JSON back
 * into objects, which over this repository's sources is a third of everything
 * instrumentation spends — work the tree has already had done to it once. Raw
 * transfer deserializes the same tree directly out of the parser's buffer into
 * the same plain objects: 63 ms becomes 19 ms over 251 modules, and the two
 * trees compare equal node for node across every source in the repository.
 *
 * It wants a 64-bit little-endian platform and says so through
 * `rawTransferSupported`. Where the answer is no, the default path returns the
 * same tree more slowly — a difference in speed, never in result, which is why
 * this is decided once here and nothing downstream is told which one it got.
 */
const TRANSFER = {
  experimentalRawTransfer: rawTransferSupported(),
} as ParserOptions;

/** Every call site invokes the generated runtime directly. */
const PROBES = {
  hit: (ordinal: number) => `__va(${ordinal})`,
  around: (ordinal: number) => [`__vaR(`, `,${ordinal})`] as const,
};

/** The JavaScript walk, or nothing when the source does not parse. */
export function splicedInJs(
  source: string,
  file: string,
  mode: InstrumentMode,
): Spliced | undefined {
  // The parser's name, never the id: oxc reads the extension to decide whether
  // it is looking at TypeScript, JSX, or neither. A module must parse the same
  // way whether or not the repository has a number for it yet.
  const parsed = parseSync(file, source, TRANSFER);

  // A recovered tree has holes in it, and a probe spliced against a hole produces
  // a file that no longer compiles. Refusing costs one uninstrumented module.
  if (parsed.errors.length > 0) return undefined;

  const walked = walkBlocks(parsed.program, source, PROBES, mode);

  // The window closes after the last top-level statement, never at the end of
  // the text: a trailing comment would swallow the call.
  const body = parsed.program.body as readonly { readonly end: number }[];
  const last = body.length === 0 ? walked.prologue : body[body.length - 1]!.end;
  const edits = [...walked.edits, { at: Math.max(walked.prologue, last), text: ';__vaE();' }];
  // Stable by construction: `Array.prototype.sort` keeps insertion order for equal
  // keys, and closing braces are emitted after the subtree that opened them, so an
  // inner `}` lands in front of an outer one at the same offset.
  const ordered = edits.sort((left, right) => left.at - right.at);

  // The header goes in front of every probe at the prologue itself: the first
  // statement after it may open with one, and `__vaR(` in front of the header
  // would wrap a function declaration in a call.
  let headerAt = walked.prologue;
  for (const edit of ordered) {
    if (edit.at >= walked.prologue) break;
    headerAt += edit.text.length;
  }

  return {
    code: splice(source, ordered),
    headerAt,
    sourceDigest: digestString(source),
    blocks: walked.blocks,
  };
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
