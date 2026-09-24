/**
 * `@variance-authority/sense/instrument` — the transform that records the path.
 *
 * A pure function of a string: `instrument(source, file)` parses, decides where
 * the execution boundaries are ([`spliced.ts`](./spliced.ts)), and splices a
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
 * ## What a probe hit costs
 *
 * Every inserted site calls `__va(i)`, or `__vaR(v, i)` where the site is an
 * expression. Almost every call is to a region the current bucket has already
 * logged, and that call is two byte reads and an `and`: the region's flags in
 * `__vaF` and the bit that answers now in `__vaP`, both module variables. A zero
 * means the region has something left to log, and only then does `__vaS` run:
 * it sets the flag and appends the region's index across the realm, with the
 * evaluating bit, to the log in [`probe-log.cts`](probe-log.cts).
 * `packages/sense/scripts/probe-write.mjs` prices the logged hit at 1.2 ns at 4
 * and 16 regions and 3.2 ns at 64, on the machine
 * [`docs/context`](../../../../docs/context/README.md) names.
 *
 * `__vaS` is its own function so that `__va` stays small enough to inline at
 * every site. Folded into `__va`, the same logic measures slower at 16 regions
 * and when V8 compiles the module only with Maglev.
 *
 * ## The runtime is a required global, and the probe does not check
 *
 * The header reads `globalThis.__VA__` when the module's own probe fires, which
 * is while the module evaluates. With no collector installed that read is
 * `undefined`, and registering the module against it is a `TypeError` in the
 * first instrumented module. That makes an incomplete runner configuration
 * visible rather than silently dropping evidence.
 *
 * Nothing in the probe tests for that state. A probe runs once per region per
 * entry and a suite runs them by the hundred million, so nothing sits in it
 * that is not part of the observation: no test that passes on every hit but
 * one, and no string constant per module carried through parse, compile and
 * bundle to be read once, by nobody, in a configuration that is already broken.
 * You get a `TypeError` and a file name.
 *
 * ## The global is read once a module
 *
 * The probe reads `globalThis.__VA__` on a module's first hit, keeps it in
 * `__vaK`, and registers the module with it once: `__vaG` is the module's flag
 * row, `__vaF` the row the fast path tests, `__vaB` the row's first index in the
 * realm, and `__vaP` the passing bit. Under Vitest keeping the root saves nothing
 * measurable, because a global load in the main realm is an inline-cached slot.
 * Under Jest it is most of the probe. Jest evaluates a test file in a `vm`
 * context, whose global object is contextified: every property read on it goes
 * through an interceptor. The probe body timed at 1087 ms reading the global on
 * every hit, and 110 ms reading it once, over the same hits in the same context.
 *
 * So the global is the realm's **root** and stays the same object for the life
 * of the realm. A collector that moves the log elsewhere — to a case, a journey,
 * or the next test file of a shared module graph — switches the bucket behind
 * the root and never reassigns the global. A module that kept a replaced root
 * would log into it, silently, for as long as it lived.
 *
 * A switch moves the root's activation, `a`. A probe that finds `a` changed
 * since its module last logged also logs the module's own region into the new
 * bucket: a case that reached a module another case evaluated entered that
 * module, and an edit to its top level is an edit the case ran.
 *
 * ## The scope, and why it is not a getter
 *
 * A collector that attributes crossings to an async scope — a test case under
 * `continuations` ([`cases.ts`](../test-selection/cases.ts)) or a service
 * journey ([`journey.ts`](../test-selection/journey.ts)) — has to ask which
 * bucket owns each crossing. The obvious install is an accessor on the realm,
 * and it is the most expensive property in the process. Measured over fifty
 * million hits inside a real async scope, an accessor on `globalThis` cost
 * **12.6 ns** a hit against **1.3 ns** for a probe over a data property. A
 * global accessor defeats the inline cache the probe is otherwise made of.
 *
 * So `__VA__` stays a data property, and the scope is the root's `s`: null
 * where only the collector switches buckets, and otherwise a function that asks
 * the scope and switches when the answer moved. An engine with a scope hands
 * the probe a gate row of zeros, so every hit reaches `__vaS`, which calls `s`.
 * `s` is a field of its own rather than an accessor on `a`, because V8 does not
 * inline the accessor, and it added about 6 ns to every scoped hit.
 *
 * With a real `AsyncLocalStorage` behind it, a hit under `continuations` costs
 * 5.8 ns at 4 regions and 6.6 ns at 16, and most of that is not ours:
 * `AsyncLocalStorage.getStore()` is **5.5 ns**, flat regardless of how deep the
 * frames nest. On Node 22 and 23 the context is a linked list rather than a
 * frame — `--no-async-context-frame` on a newer runtime reproduces it — and the
 * same read is **8.4 ns**, 44% more. The one way to pay it less often is to
 * propagate the scope yourself through `async_hooks`, which costs **444 ns** an
 * `await` against 23 ns unhooked, so that trade is only worth taking on a suite
 * with far fewer awaits than crossings. One continuation read a crossing is
 * what the case axis costs under `continuations`. Without it, cases switch
 * buckets through `use` and a hit costs what a flat one does.
 *
 * ## A probe stays in its instrumented realm
 *
 * Every inserted site calls the declarations in the generated module directly.
 * Re-evaluating an instrumented function's source in another realm loses those
 * declarations and throws, exposing that configuration error at its first probe.
 */

import { spliced as splice, type Block, type BlockKind, type InstrumentMode } from './spliced.js';

export type { Block, BlockKind, InstrumentMode };

/** Changes whenever two instrumented block universes must not share observations. */
export const INSTRUMENTATION_ID = 'sense:instrument/presence-v5';

/**
 * The recipe each mode emits under. One identity per mode, because the two
 * walks number regions differently: ordinal 3 under `entries` is a function,
 * and under `presence` it may be the `else` of the module's first `if`. A
 * record, journal or snapshot cut under one is not evidence about the other.
 */
const IDS: Readonly<Record<InstrumentMode, string>> = {
  presence: INSTRUMENTATION_ID,
  entries: 'sense:instrument/entries-v2',
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
 * The bit a log entry carries when its region was entered while a module was
 * evaluating: the top-level statements, and everything they called. A
 * collector's read-out carries it too, on the row entry for that ordinal.
 *
 * A module evaluates once per realm, inside whichever subject's window it was
 * first needed, and what it did then is every subject's. The page cannot tell
 * that entry from the subject's own, so the runtime marks it at the site: the
 * header raises an evaluating depth on the current bucket and the end of the
 * module lowers it, and every region logged while it is raised carries this
 * bit. The collectors report such an ordinal as shared. A module that throws
 * before its end leaves the depth raised, and every later region that bucket
 * logs is then shared — over-including, in the direction
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
 * `undefined` when the source could not be parsed or holds a lone surrogate, and
 * that is the whole reason it is not an exception: a file this cannot read is a
 * file whose blocks are unknown, and [ADR-0008](../../../../docs/context/adr/0008-per-profile-expectations.md)
 * says the honest report is *not instrumented*, never *not executed*. A caller
 * that swallowed a throw here would produce the second. The one throw is a
 * missing addon, which would leave every module uninstrumented.
 */
export function instrument(
  source: string,
  file: string,
  id: ModuleId = file,
  options: InstrumentOptions = {},
): Instrumented | undefined {
  const mode = options.mode ?? 'presence';
  const spliced = splice(source, file, mode);
  if (spliced === undefined) return undefined;

  const { code, headerAt, sourceDigest, blocks } = spliced;
  return {
    code: code.slice(0, headerAt) + runtime(id, blocks.length) + code.slice(headerAt),
    sourceDigest,
    instrumentation: IDS[mode],
    blocks,
  };
}

/**
 * The declarations every instrumented module carries, and its own probe.
 *
 * 671 bytes a module, 357 after gzip and 322 after brotli: the text is the same
 * in every module but two numbers, so a compressor spends almost nothing on it.
 * It is written per module rather than built by the collector because the
 * fast path is made of module variables: `__vaF` and `__vaP` are slots in the
 * module's own scope, and the gate reads them with no property lookup on any
 * object. It also keeps the collector's contract to the root's fields: the
 * evaluating protocol below is the emitter's business, and a collector —
 * one this repository ships or a foreign one — never implements it.
 *
 * Function declarations rather than `const`, because a circular import can call
 * back into this module before its own top level has run — a binding in the
 * temporal dead zone would turn that into a `ReferenceError` that only appears in
 * instrumented builds, which is the worst kind of difference to chase. `__vaF`
 * and `__vaP` start as empty functions for the same call: a byte read from a
 * function is `undefined`, the `and` of two is zero, and the probe falls through
 * to `__vaS`, which registers the module there.
 *
 * The module's own probe fires at the end of the prologue rather than at
 * offset 0, so it sits below anything Vitest hoisted. It raises the evaluating
 * depth, marks the module's own region, and logs it with {@link EVALUATING},
 * so that the module's root and everything the top level calls carry the bit
 * until `__vaE` lowers the depth after the last statement. A depth rather than
 * a flag, because a module can evaluate another one inside its top level. The
 * depth lives on the bucket and not in this module, because it is the realm's
 * fact: the module evaluating is not the only module whose probes fire while it
 * does.
 */
function runtime(id: ModuleId, count: number): string {
  const module = typeof id === 'number' ? String(id) : JSON.stringify(id);

  return (
    `var __vaK,__vaG,__vaB,__vaA;function __vaF(){}function __vaP(){}` +
    `function __vaI(){__vaK=globalThis.__VA__;const r=__vaK.r(${module},${count});__vaF=r.f;__vaG=r.s;__vaB=r.b;__vaP=r.p;return __vaK}` +
    `function __va(i){if((__vaF[i]&__vaP[0])===0)__vaS(i)}` +
    `function __vaS(i){const K=__vaK||__vaI();if(K.s!==null)K.s();const a=K.a;if(__vaA!==a){if(__vaA!==undefined&&__vaG[0]===0){__vaG[0]=1;K.g(__vaB)}__vaA=a}` +
    `const f=__vaG[i],p=__vaP[0];if((f&p)===0){__vaG[i]=f|p;const n=K.n;if(n<K.l){K.L[n]=(__vaB+i)|K.v;K.n=n+1}else K.g((__vaB+i)|K.v)}}` +
    `function __vaR(v,i){__va(i);return v}` +
    `function __vaE(){(__vaK||__vaI()).x()}` +
    `(__vaK||__vaI()).e();__vaA=__vaK.a;__vaG[0]|=__vaP[0];__vaK.g(${EVALUATING}|__vaB);`
  );
}

/**
 * The emitted runtime with placeholder numbers.
 *
 * A transform cache that keys on the instrumentation identity alone serves the
 * previous probe after this text changes: the regions are the same, so the
 * identity is too. What the text does is not a region question, and a cache
 * that stores it keys on the text.
 */
export const PROBE_RUNTIME = runtime(0, 0);
