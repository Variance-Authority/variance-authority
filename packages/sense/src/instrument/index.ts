/**
 * `@variance-authority/sense/instrument` — the transform that records the path.
 *
 * A pure function of a string: `instrument(source, file)` parses, decides where
 * the execution boundaries are ([`blocks.ts`](./blocks.ts)), and splices a
 * recording call in front of each one. No disk, no runner, no index. That is
 * deliberate — this is the only part of
 * [spec 0027](../../../../docs/specs/0027-a-test-is-selected-by-what-it-executed.md)
 * that *manufactures* an artifact, so it is the first thing to build and the
 * cheapest thing to refute.
 *
 * ## Two modes, two identities
 *
 * `presence` probes every arrival region. `entries` probes modules and function
 * bodies and nothing inside them: a run that only has to say which functions a
 * test reached, or which ran before the test began, pays for a probe per
 * function rather than one per decision. The two number regions differently and
 * so report under different {@link instrumentationId} values, and nothing that
 * reads one accepts the other.
 *
 * ## Lines are preserved exactly
 *
 * Every insertion is single-line — no emitted text contains a newline — so a stack
 * trace, a `//# sourceMappingURL` further down the chain and a coverage tool
 * reading the same file all still agree about line numbers. Columns shift, which
 * is what a source map would exist to fix, and which nothing yet needs.
 *
 * ## The runtime is a required global, and the probe does not check
 *
 * The emitted header resolves `globalThis.__VA__` on first use. An instrumented
 * module with no collector throws at its first probe, which is what makes an
 * incomplete runner configuration visible rather than silently dropping
 * evidence, and the throw is the engine's: `g.s` on `undefined`.
 *
 * There was a guarded version of this — `g && g.s`, a `typeof` on the resolved
 * factory, and a sentence per module naming the file and the fix. It is gone
 * on purpose. A probe runs once per region per entry and a suite runs them by
 * the hundred million, so nothing sits in it that is not part of the
 * observation: no test that passes on every hit but one, and no string
 * constant per module carried through parse, compile and bundle to be read
 * once, by nobody, in a configuration that is already broken. The states it
 * described are still reachable and still fatal — the first probe still stops
 * the run — and the reader gets a `TypeError` and a file name instead of a
 * paragraph.
 *
 * `__va.c === undefined` went with them, and that one was never defence.
 * `__va.r` starts `undefined`, no factory is `undefined`, so the identity test
 * already answers the first call; the extra load and compare were redundant on
 * every hit after it.
 *
 * ## The scope resolver, and why it is not a getter
 *
 * A collector that attributes crossings to an async scope — a test case
 * ([`cases.ts`](../test-selection/cases.ts)) or a service journey
 * ([`journey.ts`](../test-selection/journey.ts)) — needs a different factory per
 * scope, and the probe's cache invalidates on the factory's identity, so the
 * obvious install is an accessor on the realm. It is the most expensive property
 * in the process. Measured one shape to a process, fifty million hits inside a
 * real async scope on the machine
 * [`docs/context`](../../../../docs/context/README.md) names: an accessor on
 * `globalThis` that looked the factory up by the key in its store cost
 * **12.6 ns** a hit, against **1.3 ns** for the flat probe over a data property.
 * A global accessor defeats the inline cache the probe is otherwise entirely
 * made of, and a probe runs once per region per entry.
 *
 * So `__VA__` stays a data property, and the scope lives one level in, on the
 * factory's own `s`: a function answering *which factory owns the scope running
 * now*. The probe calls it when it is there and answers with the factory itself
 * when it is not, and the store holds the factory rather than a key to look one
 * up by. That is **6.3 ns** scoped, half the accessor's price. Every
 * collector defines `s`, absent being spelled `undefined` rather than missing,
 * so the load reads one shape whichever collector is installed.
 *
 * What is left is not ours. Of those 6.3 ns, **5.5** are
 * `AsyncLocalStorage.getStore()`, flat regardless of how deep the frames nest.
 * Hand the same probe a closure variable instead of a store and it reads
 * **1.6 ns**, a fifth over the flat price: the probe is free and the
 * continuation read is the whole cost. On Node 22 and 23 the context is a
 * linked list rather than a frame — `--no-async-context-frame` on a newer
 * runtime reproduces it — and the same crossing reads **8.4 ns**, 44% more.
 * The one
 * way to pay it less often is to propagate the scope ourselves through
 * `async_hooks`, which costs **444 ns** an `await` against 23 ns unhooked, so
 * that trade is only worth taking on a suite with far fewer awaits than
 * crossings. Until the transform hoists the read to a function activation, one
 * continuation read a crossing is what the case axis costs.
 *
 * ## A probe stays in its instrumented realm
 *
 * Every inserted site calls the declarations in the generated module directly.
 * Re-evaluating an instrumented function's source in another realm loses those
 * declarations and throws, exposing that configuration error at its first probe.
 */

import { digestString } from '../digest.js';
import { parseSync, rawTransferSupported, type ParserOptions } from 'oxc-parser';
import { walkBlocks, type Block, type BlockKind, type Edit, type InstrumentMode } from './blocks.js';

export type { Block, BlockKind, Edit, InstrumentMode };

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
const TRANSFER = { experimentalRawTransfer: rawTransferSupported() } as ParserOptions;

/** Changes whenever two instrumented block universes must not share observations. */
export const INSTRUMENTATION_ID = 'sense:instrument/presence-v4';

/**
 * The recipe each mode emits under. One identity per mode, because the two
 * walks number regions differently: ordinal 3 under `entries` is a function,
 * and under `presence` it may be the `else` of the module's first `if`. A
 * record, journal or snapshot cut under one is not evidence about the other.
 */
const IDS: Readonly<Record<InstrumentMode, string>> = {
  presence: INSTRUMENTATION_ID,
  entries: 'sense:instrument/entries-v1',
};

export function instrumentationId(mode: InstrumentMode = 'presence'): string {
  return IDS[mode];
}

/** The mode an identity names, or nothing for a recipe this build does not emit. */
export function instrumentModeOf(instrumentation: string): InstrumentMode | undefined {
  return (Object.keys(IDS) as InstrumentMode[]).find((mode) => IDS[mode] === instrumentation);
}

export interface InstrumentOptions {
  /** `presence` records every arrival region; `entries` only modules and functions. */
  readonly mode?: InstrumentMode;
}

/**
 * The bit a counter carries when its region was entered while the module was
 * evaluating: the top-level statements, and everything they called.
 *
 * A module evaluates once per realm, inside whichever subject's window it was
 * first needed, and what it did then is every subject's. The page cannot tell
 * that entry from the subject's own, so the runtime marks it at the site: a
 * depth on the factory that the header raises and the end of the module lowers,
 * and every probe fired while it is raised sets this bit on its counter. The low
 * bits still count; the collectors mask it out and report the ordinal as
 * shared. A module that throws before its end leaves the depth raised, and every
 * later region on that page is then shared — over-including, in the direction
 * [`selecting.md`](../../../../docs/selecting.md) argues for.
 */
export const EVALUATING = 0x80000000;

/**
 * What an instrumented module reports itself as, and the only identity that
 * reaches the running code.
 *
 * A number when the repository has one for the file — see
 * [`module-names`](../module-names.ts) for where numbers come from and why they
 * are assigned rather than derived from the path. The module is handed its own
 * number by the transform, so the emitted code states it as a literal and the
 * running code consults nothing.
 *
 * The path otherwise. A transform is handed a module and must return text; it
 * cannot wait for a number and must not invent one, and the path is the one
 * other thing exactly as unique as the module. It costs its own length at every
 * crossing for one run: the fold numbers what the journals reported, and the
 * next transform of that file emits a number.
 */
export type ModuleId = number | string;

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
export function instrument(
  source: string,
  file: string,
  id: ModuleId = file,
  options: InstrumentOptions = {},
): Instrumented | undefined {
  const mode = options.mode ?? 'presence';
  // The parser's name, never the id: oxc reads the extension to decide whether
  // it is looking at TypeScript, JSX, or neither. A module must parse the same
  // way whether or not the repository has a number for it yet.
  const parsed = parseSync(file, source, TRANSFER);

  // A recovered tree has holes in it, and a probe spliced against a hole produces
  // a file that no longer compiles. Refusing costs one uninstrumented module.
  if (parsed.errors.length > 0) return undefined;

  const walked = walkBlocks(parsed.program, source, PROBES, mode);
  const header = runtime(id, walked.blocks.length);

  // The window closes after the last top-level statement, never at the end of
  // the text: a trailing comment would swallow the call. A module with no body
  // closes right after it opens, at the same offset, and the stable sort below
  // keeps the header in front.
  const body = parsed.program.body as readonly { readonly end: number }[];
  const last = body.length === 0 ? walked.prologue : body[body.length - 1]!.end;
  const edits = [
    ...walked.edits,
    { at: walked.prologue, text: header },
    { at: Math.max(walked.prologue, last), text: ';__vaE();' },
  ];
  // Stable by construction: `Array.prototype.sort` keeps insertion order for equal
  // keys, and closing braces are emitted after the subtree that opened them, so an
  // inner `}` lands in front of an outer one at the same offset.
  const ordered = edits.sort((left, right) => left.at - right.at);

  return {
    code: splice(source, ordered),
    sourceDigest: digestString(source),
    instrumentation: IDS[mode],
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
 * The three hoisted declarations every instrumented module carries.
 *
 * Written per module rather than hoisted into the collector, and that is a
 * measurement, not a preference. Replacing this text with a single destructure
 * of a factory-built triple saves 316 bytes a module of source, 13 after gzip
 * and 7 after brotli — the prologue is identical in every module but two
 * numbers, so a compressor already spends almost nothing on it — and 2.5µs a
 * module of compile. What it costs is the collector contract: the depth
 * protocol below is the emitter's business alone, and a factory that built the
 * probes would have to implement it, in every collector this repository ships
 * and every foreign one. Seven bytes does not buy that.
 *
 * Function declarations rather than a `const`, because a circular import can call
 * back into this module before its own top level has run — a binding in the
 * temporal dead zone would turn that into a `ReferenceError` that only appears in
 * instrumented builds, which is the worst kind of difference to chase.
 *
 * The module's own probe fires here, at the end of the prologue rather than at
 * offset 0, so it sits below anything vitest hoisted. It then raises the
 * evaluating depth on the factory it resolved, and marks its own counter, so
 * that the module's root and everything the top level calls carry
 * {@link EVALUATING} until `__vaE` lowers the depth after the last statement.
 * A depth rather than a flag, because a module can evaluate another one inside
 * its top level. The depth lives on the factory and not in this module, because
 * it is the realm's fact: the module evaluating is not the only module whose
 * probes fire while it does.
 *
 * A module that finds a different factory than the one it registered with has
 * outlived a test file: a runner that shares one module graph across files —
 * Vitest without isolation — installs a factory per file and evaluates the
 * module once. Its top level ran for the first file only, and every later file
 * consumed what it exported without a module probe firing. So re-registering
 * counts the module's own block once, the way evaluation would have: the file
 * entered this module, and an edit to its top level is an edit that file ran.
 */
function runtime(id: ModuleId, count: number): string {
  const module = typeof id === 'number' ? String(id) : JSON.stringify(id);

  return (
    `function __va(i){const g=globalThis.__VA__;const r=g.s?g.s():g;if(__va.r!==r){const again=__va.c!==undefined;__va.r=r;__va.c=r(${module},${count});if(again)__va.c[0]+=1}__va.c[i]=__va.c[i]+1|(r.e>0?${EVALUATING}:0)}` +
    `function __vaR(v,i){__va(i);return v}` +
    `function __vaE(){const g=globalThis.__VA__;const r=g.s?g.s():g;r.e=r.e>1?r.e-1:0}` +
    `__va(0);__va.r.e=(__va.r.e|0)+1;__va.c[0]|=${EVALUATING};`
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
