// Placing a previous run's crossings on the regions of the text standing now,
// where an address alone does not tell two regions of one module apart, and
// where the text standing now holds regions no run was ever cut over.

import { describe, expect, it } from 'vitest';
import { INSTRUMENTATION_ID, instrument, instrumentModeOf } from '../instrument/index.js';
import { changedLines } from './diff-lines.js';
import { encodeTestCoverage } from './format.js';
import { openTestCoverage } from './format-view.js';
import { coverageBlock, coverageBlocks } from './coverage-rows.js';
import { editKey } from './edit-readings.js';
import { digestString } from '../digest.js';
import { recutRows } from './merge-carry.js';
import { mergeCoverage } from './merge.js';
import { narrowByExecutionFromView } from './select.js';
import { sourceLines } from './source-lines.js';
import type { CoverageModule, TestCoverage } from './index.js';

const BASELINE = '1111111111111111111111111111111111111111';
const LOCAL = '2222222222222222222222222222222222222222';

/**
 * A component whose two effects are one address and two regions.
 *
 * A call-argument closure is named after the callee it is an argument to, so
 * both of these bodies are recorded as `Widget/useEffect.arg0` at `entry`. The
 * text is instrumented here rather than written out as rows because the
 * collision is the recipe's, not the fixture's.
 */
const WIDGET = `export function Widget(props) {
  useEffect(() => {
    open(props.a);
  }, [props.a]);

  useEffect(() => {
    close(props.b);
  }, [props.b]);

  return props.a;
}
`;

const BOTH = ['test/alpha.test.ts', 'test/beta.test.ts'];

/** `src/widget.js` as `source` cuts it, region `n` entered by `entered[n]`. */
function widget(
  commit: string | undefined,
  source: string,
  entered: readonly (readonly string[])[],
): TestCoverage {
  const fresh = instrument(source, 'src/widget.js', 'src/widget.js')!;
  return {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    ...(commit === undefined ? {} : { commit }),
    tests: [...new Set(entered.flat())].sort().map((file) => ({
      file,
      complete: true,
      preconditions: [{ name: file, digest: 'source:test' }],
    })),
    modules: [{
      file: 'src/widget.js',
      sourceDigest: fresh.sourceDigest,
      instrumented: true,
      blocks: fresh.blocks.map((block) => ({
        ...coverageBlock(source, block),
        testFiles: [...(entered[block.ordinal] ?? [])],
      })),
    }],
  };
}

/** The crossings on each of the two effect bodies, in the order they are cut. */
function effects(coverage: TestCoverage): readonly (readonly string[])[] {
  return coverage.modules[0]!.blocks
    .filter((block) => block.name === 'Widget/useEffect.arg0')
    .map((block) => block.testFiles);
}

describe('carrying crossings onto repeated addresses', () => {
  it('leaves each of two regions at one address holding the crossing it was recorded with', () => {
    // What the record holds is alpha inside the first effect and beta inside the
    // second, and the two rows are one address apiece: `Widget/useEffect.arg0`
    // at `entry`, twice. A watch loop then re-records the module — gamma renders
    // the component and fires neither effect — and the previous rows are placed
    // by address, so both of them land on the first row that answers to it. The
    // later write wins: beta's crossing replaces alpha's on the first effect and
    // the second effect is left holding nothing, with no demotion anywhere,
    // because every previous row did find a region to carry onto. A diff of the
    // first effect's lines is then answered with the test that entered the
    // second one, and alpha — the only test known to have entered exactly those
    // lines — is in the caller's skip list.
    const merged = mergeCoverage(
      widget(BASELINE, WIDGET, [BOTH, BOTH, ['test/alpha.test.ts'], ['test/beta.test.ts']]),
      widget(LOCAL, WIDGET, [['test/gamma.test.ts'], ['test/gamma.test.ts'], [], []]),
    );

    expect(effects(merged)).toEqual([['test/alpha.test.ts'], ['test/beta.test.ts']]);
    expect(merged.tests.every((test) => test.complete)).toBe(true);
  });

  it('re-cuts two regions at one address onto the regions their crossings name', () => {
    // The same pair of effects in a module this run never loaded, over text that
    // moved: the rows are cut out of the text standing now and each crossing is
    // carried onto the region with its address. One address, two regions, so
    // carrying by the address alone hands both previous rows to the first effect
    // and beta ends up recorded against both bodies while alpha is recorded
    // against neither. Nothing reports it: alpha still holds the module and the
    // component entry, so it is not a mislaid test, and a diff inside the first
    // effect skips the test that entered it. Both are demoted for the line the
    // module gained, which neither ran; the placement is what this pins.
    const merged = mergeCoverage(
      widget(BASELINE, WIDGET, [BOTH, BOTH, ['test/alpha.test.ts'], ['test/beta.test.ts']]),
      {
        version: 3,
        instrumentation: INSTRUMENTATION_ID,
        commit: LOCAL,
        tests: [{
          file: 'test/gamma.test.ts',
          complete: true,
          preconditions: [{ name: 'test/gamma.test.ts', digest: 'source:test' }],
        }],
        modules: [],
      },
      new Map([['src/widget.js', `const scale = 2;\n\n${WIDGET}`]]),
    );

    expect(effects(merged)).toEqual([['test/alpha.test.ts'], ['test/beta.test.ts']]);
    expect(merged.modules[0]?.blocks.map((block) => block.startLine)).toEqual([1, 3, 4, 8]);
    expect(merged.tests.filter((test) => !test.complete).map((test) => test.file)).toEqual(BOTH);
  });

  it('demotes a carried test whose region was edited under a run that did not observe it', () => {
    // Gamma renders the component over an edit to the first effect's body and
    // fires neither effect. Alpha's crossing is carried onto the edited body,
    // and the rows now hold the edited text, so no later diff shows alpha the
    // edit: it is demoted. Beta's body is the text it ran over, and it stays.
    const edited = WIDGET.replace('open(props.a);', 'open(props.a + 1);');
    const merged = mergeCoverage(
      widget(BASELINE, WIDGET, [BOTH, BOTH, ['test/alpha.test.ts'], ['test/beta.test.ts']]),
      widget(LOCAL, edited, [['test/gamma.test.ts'], ['test/gamma.test.ts'], [], []]),
    );

    expect(effects(merged)).toEqual([['test/alpha.test.ts'], ['test/beta.test.ts']]);
    expect(merged.tests.filter((test) => !test.complete).map((test) => test.file)).toEqual(['test/alpha.test.ts']);
  });
});

const RULES = 'src/rules.ts';
const CART = 'test/cart.test.ts';
const OTHER = 'test/other.test.ts';

/** `apply` alone: the text the recording was cut from. */
const V1 = `export function apply(order) {
  if (order.rush) {
    return order.total + 10;
  }
  return order.total;
}
`;

/** The same module after a second exported function was written under it. */
const V2 = `export function apply(order) {
  if (order.rush) {
    return order.total + 10;
  }
  return surcharge(order.total);
}
export function surcharge(total) {
  if (total > 100) {
    return total * 0.9;
  }
  return total;
}
`;

/** One line inside the body of the branch only the current text has. */
const EDIT = `diff --git a/${RULES} b/${RULES}
--- a/${RULES}
+++ b/${RULES}
@@ -9 +9 @@ export function surcharge(total) {
-    return total * 0.9;
+    return total * 0.8;
`;

/** `src/rules.ts` as `source` cuts it, every region entered by `entered`. */
function rules(source: string, entered: readonly string[]): CoverageModule {
  const cut = instrument(source, RULES, RULES, { mode: 'presence' })!;
  return {
    file: RULES,
    sourceDigest: cut.sourceDigest,
    instrumented: true,
    blocks: cut.blocks.map((block) => ({
      ...coverageBlock(source, block),
      testFiles: [...entered],
      ...(entered.length === 0 ? {} : { loadedBy: [...entered] }),
    })),
  };
}

/** The full suite: cart entered every region of `src/rules.ts`, other reached none. */
function suite(module: CoverageModule): TestCoverage {
  return {
    version: 3,
    instrumentation: INSTRUMENTATION_ID,
    commit: BASELINE,
    tests: [CART, OTHER].map((file) => ({
      file,
      complete: true,
      preconditions: [{ name: file, digest: `source:${file}` }],
    })),
    modules: [module],
  };
}

function crossingsOf(module: CoverageModule, name: string, path: string): readonly string[] {
  return module.blocks.find((block) => block.name === name && block.path === path)?.testFiles ?? [];
}

describe('re-cutting over text a region was written into', () => {
  it('gives a region the text gained the crossings of the region around it', () => {
    // `surcharge` was written after the run that recorded this module, so no
    // probe ever stood in it and no address in the table answers to it. What is
    // known is that cart entered the module, and the new function's text is
    // inside the module's: cart reached that text or nothing did. Emitting the
    // row holding nothing says the opposite, in the same bytes a measurement
    // uses, and no reader downstream can tell the two apart.
    const recut = recutRows(rules(V1, [CART]), V2, INSTRUMENTATION_ID) as CoverageModule;

    expect(crossingsOf(recut, 'apply', 'entry')).toEqual([CART]);
    expect(crossingsOf(recut, 'surcharge', 'entry')).toEqual([CART]);
    expect(crossingsOf(recut, 'surcharge', 'if#0/then')).toEqual([CART]);
    expect(crossingsOf(recut, 'surcharge', 'if#0/after')).toEqual([CART]);
  });

  it('carries what loaded the region around a gained one onto it too', () => {
    const recut = recutRows(rules(V1, [CART]), V2, INSTRUMENTATION_ID) as CoverageModule;

    expect(recut.blocks.find((block) => block.name === 'surcharge')?.loadedBy).toEqual([CART]);
  });

  it('leaves a region gained inside a measured empty one empty', () => {
    // The widening is the region around it, and here that region is a
    // measurement: this run entered `apply` and did not take its branch. A test
    // that never entered the branch entered nothing written inside it, so the
    // empty on the new rows is the deduction the record supports rather than a
    // claim about text nobody ran over.
    const measured = rules(V1, [CART]);
    const partial: CoverageModule = {
      ...measured,
      blocks: measured.blocks.map((block) =>
        block.path === 'if#0/then' ? { ...block, testFiles: [], loadedBy: [] } : block,
      ),
    };
    const deeper = V1.replace(
      '    return order.total + 10;',
      '    if (order.vip) {\n      return 0;\n    }\n    return order.total + 10;',
    );
    const recut = recutRows(partial, deeper, INSTRUMENTATION_ID) as CoverageModule;

    expect(crossingsOf(recut, 'apply', 'entry')).toEqual([CART]);
    expect(crossingsOf(recut, 'apply', 'if#0/then')).toEqual([]);
    expect(crossingsOf(recut, 'apply', 'if#0/then/if#0/then')).toEqual([]);
  });

  it('still selects the test that reaches a gained region when its text is edited', () => {
    // The whole consequence, through the columns a caller reads. cart is the
    // only test that reaches `src/rules.ts`, `surcharge` was written after cart
    // was last recorded, and the diff is inside it. Answered with the empty the
    // re-cut invented, cart is in the caller's skip list over a change to the
    // only code it covers — and stays there for every later diff, because the
    // row holding the invention is stamped with the text standing now. Cart is
    // also demoted, for `surcharge` itself, which it never ran.
    const merged = mergeCoverage(
      suite(rules(V1, [CART])),
      {
        version: 3,
        instrumentation: INSTRUMENTATION_ID,
        commit: LOCAL,
        tests: [{ file: OTHER, complete: true, preconditions: [{ name: OTHER, digest: `source:${OTHER}` }] }],
        modules: [],
      },
      new Map([[RULES, V2]]),
    );
    const answer = narrowByExecutionFromView(openTestCoverage(encodeTestCoverage(merged)), EDIT);

    expect([...changedLines(EDIT).get(RULES) ?? []]).toEqual([{ start: 9, end: 9 }]);
    expect(answer.whole).toEqual([OTHER]);
    expect(answer.entered).toEqual([CART]);
  });
});

const PRICING = 'src/pricing.ts';

/** Two functions, each entered by its own test. */
const PRICED = `export function price(order) {
  return order.total;
}

export function label(order) {
  return order.name;
}
`;

/**
 * `src/pricing.ts` cut from `source` as the landing cuts it, each function's
 * region entered by the test `entered` names for it and the module by all of
 * them.
 */
function pricing(source: string, entered: Readonly<Record<string, string>>): CoverageModule {
  const fresh = instrument(source, PRICING, PRICING, { mode: instrumentModeOf(INSTRUMENTATION_ID)! })!;
  const rows = coverageBlocks(fresh.blocks, { extentOf: sourceLines(source, undefined, PRICING), text: source });
  return {
    file: PRICING,
    sourceDigest: fresh.sourceDigest,
    instrumented: true,
    blocks: rows.map((row) => ({
      ...row,
      testFiles: row.kind === 'module' ? Object.values(entered).sort() : [entered[row.name]].filter((test) => test !== undefined),
    })),
  };
}

describe('re-cutting over an edited body', () => {
  it('demotes the test on the region whose text moved, and only that one', () => {
    // A run of a third test lands while `price`'s body is edited on disk and
    // loads nothing of `src/pricing.ts`. The landing re-cuts the module in the
    // edited text and keeps that text, so the next selection reads no diff
    // there: cart ran the old body of `price` and nothing has run the new one,
    // and only a demotion still runs it. `label` is the text other ran, as it
    // stands.
    const previous: TestCoverage = {
      version: 3,
      instrumentation: INSTRUMENTATION_ID,
      commit: BASELINE,
      tests: [CART, OTHER].map((file) => ({ file, complete: true, preconditions: [] })),
      modules: [pricing(PRICED, { price: CART, label: OTHER })],
    };
    const merged = mergeCoverage(previous, {
      version: 3,
      instrumentation: INSTRUMENTATION_ID,
      commit: LOCAL,
      tests: [{ file: 'test/third.test.ts', complete: true, preconditions: [] }],
      modules: [],
    }, new Map([[PRICING, PRICED.replace('return order.total;', 'return order.total * 2;')]]));

    expect(merged.tests.filter((test) => !test.complete).map((test) => test.file)).toEqual([CART]);
  });

  it('demotes nobody over an edit the selector reads as running nothing differently', () => {
    // A comment moves the digest of the region it is written in, and the
    // selector, reading the two texts, finds the program they run equal.
    const edited = PRICED.replace('  return order.total;', '  // the total, taxes included\n  return order.total;');
    const merged = mergeCoverage({
      version: 3,
      instrumentation: INSTRUMENTATION_ID,
      commit: BASELINE,
      tests: [CART, OTHER].map((file) => ({ file, complete: true, preconditions: [] })),
      modules: [pricing(PRICED, { price: CART, label: OTHER })],
    }, {
      version: 3,
      instrumentation: INSTRUMENTATION_ID,
      commit: LOCAL,
      tests: [{ file: 'test/third.test.ts', complete: true, preconditions: [] }],
      modules: [],
    }, new Map([[PRICING, edited]]), new Map([[editKey(PRICING, digestString(PRICED), digestString(edited)), 'none']]));

    expect(merged.tests.filter((test) => !test.complete)).toEqual([]);
  });

  it('demotes a test the edit left with no region at all', () => {
    // `other` entered `label` alone, and the edit deleted `label`: no region of
    // the text standing now holds `other`, so no diff could reach it again.
    const priced = pricing(PRICED, { price: CART, label: OTHER });
    const merged = mergeCoverage({
      version: 3,
      instrumentation: INSTRUMENTATION_ID,
      commit: BASELINE,
      tests: [CART, OTHER].map((file) => ({ file, complete: true, preconditions: [] })),
      modules: [{ ...priced, blocks: priced.blocks.map((row) => (row.kind === 'module' ? { ...row, testFiles: [CART] } : row)) }],
    }, {
      version: 3,
      instrumentation: INSTRUMENTATION_ID,
      commit: LOCAL,
      tests: [{ file: 'test/third.test.ts', complete: true, preconditions: [] }],
      modules: [],
    }, new Map([[PRICING, PRICED.slice(0, PRICED.indexOf('export function label'))]]));

    expect(merged.tests.filter((test) => !test.complete).map((test) => test.file)).toContain(OTHER);
  });
});
