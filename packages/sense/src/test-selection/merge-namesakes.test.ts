// Placing a previous run's crossings on namesakes: regions of one module at one
// address, told apart by occurrence over one text and by their bodies across
// an edit.

import { describe, expect, it } from 'vitest';
import { INSTRUMENTATION_ID, instrument } from '../instrument/index.js';
import { coverageBlocks } from './coverage-rows.js';
import { owedByRecut } from './merge-carry.js';
import { mergeCoverage } from './merge.js';
import { sourceLines } from './source-lines.js';
import type { CoverageBlock, CoverageModule, TestCoverage } from './index.js';

const BASELINE = '1111111111111111111111111111111111111111';
const LOCAL = '2222222222222222222222222222222222222222';
const ALPHA = 'test/alpha.test.ts';
const BETA = 'test/beta.test.ts';
const GAMMA = 'test/gamma.test.ts';
const BOTH = [ALPHA, BETA];

/**
 * A component whose two effects are one address and two regions.
 *
 * A call-argument closure is named after the callee it is an argument to, so
 * both of these bodies are recorded as `Widget/useEffect.arg0` at `entry`. The
 * text is instrumented here rather than written out as rows because the
 * collision is the recipe's, not the fixture's. Both effects depend on the
 * same `[props]`, so a body can move between them without the component's own
 * lines changing.
 */
const WIDGET = `export function Widget(props) {
  useEffect(() => {
    open(props.a);
  }, [props]);

  useEffect(() => {
    close(props.b);
  }, [props]);

  return props.a;
}
`;

/**
 * {@link WIDGET} with its first effect taken out and a third written behind
 * the second. The component still holds two effects at the lines the two
 * recorded ones stood at, so occurrence reads this text as one where both
 * bodies were edited where they stand.
 */
const SHIFTED = `export function Widget(props) {
  useEffect(() => {
    close(props.b);
  }, [props]);

  useEffect(() => {
    reset(props.c);
  }, [props]);

  return props.a;
}
`;

/** `src/widget.js` as `source` cuts it, region `n` entered by `entered[n]`. */
function widget(
  commit: string | undefined,
  source: string,
  entered: readonly (readonly string[])[],
): TestCoverage {
  const fresh = instrument(source, 'src/widget.js', 'src/widget.js')!;
  const rows = coverageBlocks(fresh.blocks, { extentOf: sourceLines(source, undefined, 'src/widget.js'), text: source });
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
      blocks: rows.map((row) => ({ ...row, testFiles: [...(entered[row.ordinal] ?? [])] })),
    }],
  };
}

/** A run that recorded gamma and loaded no module: every module it holds is carried. */
const ELSEWHERE: TestCoverage = {
  version: 3,
  instrumentation: INSTRUMENTATION_ID,
  commit: LOCAL,
  tests: [{ file: GAMMA, complete: true, preconditions: [{ name: GAMMA, digest: 'source:test' }] }],
  modules: [],
};

/** The crossings on each effect body, in the order they are cut. */
function effects(coverage: TestCoverage): readonly (readonly string[])[] {
  return coverage.modules[0]!.blocks
    .filter((block) => block.name === 'Widget/useEffect.arg0')
    .map((block) => block.testFiles);
}

function demoted(coverage: TestCoverage): readonly string[] {
  return coverage.tests.filter((test) => !test.complete).map((test) => test.file);
}

const RECORDED = widget(BASELINE, WIDGET, [BOTH, BOTH, [ALPHA], [BETA]]);

describe('carrying crossings onto namesakes', () => {
  it('leaves each namesake holding the crossing it was recorded with over the same text', () => {
    // A watch loop re-records the module — gamma renders the component and
    // fires neither effect. Placed by the bare address, both previous rows land
    // on the first effect and the later write wins: a diff of the first effect
    // is answered with beta, and alpha is skipped.
    const merged = mergeCoverage(RECORDED, widget(LOCAL, WIDGET, [[GAMMA], [GAMMA], [], []]));

    expect(effects(merged)).toEqual([[ALPHA], [BETA]]);
    expect(demoted(merged)).toEqual([]);
  });

  it('re-cuts each namesake onto the crossing of the body it holds when only the text around them moved', () => {
    // A line written above the component moves both effects, and their bodies
    // stay what they were. Both are demoted for the line the module gained,
    // which neither ran.
    const merged = mergeCoverage(RECORDED, ELSEWHERE, new Map([['src/widget.js', `const scale = 2;\n\n${WIDGET}`]]));

    expect(effects(merged)).toEqual([[ALPHA], [BETA]]);
    expect(merged.modules[0]?.blocks.map((block) => block.startLine)).toEqual([1, 3, 4, 8]);
    expect(demoted(merged)).toEqual(BOTH);
  });

  it('demotes only the tests on the namesake whose body a re-recording run saw edited', () => {
    // Gamma renders the component over an edit to the first effect's body. The
    // second effect's body is the one beta ran over, and it keeps beta. The
    // first is a body no run entered: it takes the component's crossings, and
    // alpha, whose body is gone, is demoted.
    const edited = WIDGET.replace('open(props.a);', 'open(props.a + 1);');
    const merged = mergeCoverage(RECORDED, widget(LOCAL, edited, [[GAMMA], [GAMMA], [], []]));

    expect(effects(merged)).toEqual([BOTH, [BETA]]);
    expect(demoted(merged)).toEqual([ALPHA]);
  });
});

describe('namesakes, one taken out in front and one written behind', () => {
  // Paired by occurrence, the first effect of the new text — beta's body —
  // takes alpha's crossing and the effect written behind takes beta's: a diff
  // of `close` is answered with alpha and beta is skipped. Paired by body, beta
  // stays on `close`, alpha's body is gone, and `reset` is a region gained.

  it('re-cuts the surviving namesake onto its own crossing and the gained one onto the component\'s', () => {
    const merged = mergeCoverage(RECORDED, ELSEWHERE, new Map([['src/widget.js', SHIFTED]]));

    expect(effects(merged)).toEqual([[BETA], BOTH]);
  });

  it('demotes only the tests on the namesake taken out when a run re-records the module', () => {
    const merged = mergeCoverage(RECORDED, widget(LOCAL, SHIFTED, [[GAMMA], [GAMMA], [], []]));

    expect(effects(merged)).toEqual([[BETA], BOTH]);
    expect(demoted(merged)).toEqual([ALPHA]);
  });
});

describe('namesakes with one body', () => {
  it('carries neither crossing onto the namesake left when two identical bodies become one', () => {
    // Which of the two went is the question the bodies cannot answer, so the
    // one left is a gained region and both tests are demoted.
    const twice = WIDGET.replace('close(props.b);', 'open(props.a);');
    const once = twice.replace('  useEffect(() => {\n    open(props.a);\n  }, [props]);\n\n', '');
    const merged = mergeCoverage(
      widget(BASELINE, twice, [BOTH, BOTH, [ALPHA], [BETA]]),
      widget(LOCAL, once, [[GAMMA], [GAMMA], []]),
    );

    expect(effects(merged)).toEqual([BOTH]);
    expect(demoted(merged)).toEqual(BOTH);
  });
});

/** A region of `src/widget.js` as written by hand: no lines, a digest that is a label. */
function region(ordinal: number, owner: number | undefined, digest: string, testFiles: readonly string[]): CoverageBlock {
  return {
    ordinal,
    kind: owner === undefined ? 'module' : 'function',
    ...(owner === undefined ? {} : { owner }),
    digest,
    name: ordinal === 0 ? '' : ordinal === 1 ? 'Widget' : 'Widget/useEffect.arg0',
    path: 'entry',
    source: true,
    testFiles,
  };
}

function cut(sourceDigest: string, blocks: readonly CoverageBlock[]): CoverageModule {
  return { file: 'src/widget.js', sourceDigest, instrumented: true, blocks };
}

describe('the tests a re-cut owes a run', () => {
  it('owes nothing for a namesake whose body the cut still holds after its sibling went', () => {
    // Paired by occurrence, `close` is read as the first effect edited, and
    // beta is owed a run over a body it already ran.
    const before = cut('v1', [region(0, undefined, 'm', BOTH), region(1, 0, 'w', BOTH), region(2, 1, 'open', [ALPHA]), region(3, 1, 'close', [BETA])]);
    const after = cut('v2', [region(0, undefined, 'm', BOTH), region(1, 0, 'w', BOTH), region(2, 1, 'close', [BETA])]);

    expect(owedByRecut(before, after, () => true)).toEqual([]);
  });
});

/**
 * Two effects, each holding a callback of `items.map`: the callbacks are
 * namesakes too, one inside each effect, and the second effect holds a branch
 * of its own. Alpha entered the first effect and its callback; beta entered
 * the second effect around its callback and branch, and delta entered all three.
 */
const NESTED = `export function Widget(props) {
  useEffect(() => {
    items.map((x) => {
      return x + 1;
    });
    open(props.a);
  }, [props]);

  useEffect(() => {
    items.map((x) => {
      return x + 2;
    });
    if (props.b) {
      close(props.b);
    }
  }, [props]);

  return props.a;
}
`;

const DELTA = 'test/delta.test.ts';
const EVERY = [ALPHA, BETA, DELTA];

/**
 * {@link NESTED} with its first effect taken out and a third written behind
 * the second, holding the callback body the first effect held.
 */
const NESTED_SHIFTED = `export function Widget(props) {
  useEffect(() => {
    items.map((x) => {
      return x + 2;
    });
    if (props.b) {
      close(props.b);
    }
  }, [props]);

  useEffect(() => {
    items.map((x) => {
      return x + 1;
    });
    reset(props.c);
  }, [props]);

  return props.a;
}
`;

/** The crossings on each region at `name` and `path`, in the order they are cut. */
function crossings(coverage: TestCoverage, name: string, path = 'entry'): readonly (readonly string[])[] {
  return coverage.modules[0]!.blocks.filter((block) => block.name === name && block.path === path).map((block) => block.testFiles);
}

/** {@link NESTED} re-recorded over `source` by a run in which gamma rendered the component and entered nothing inside it. */
function rerecordedNested(source: string): TestCoverage {
  const recorded = widget(BASELINE, NESTED, [EVERY, EVERY, [ALPHA], [ALPHA], [BETA, DELTA], [DELTA], [DELTA], [BETA]]);
  return mergeCoverage(recorded, widget(LOCAL, source, [[GAMMA], [GAMMA]]));
}

describe('regions inside namesakes', () => {
  it('keeps the crossing of a region inside a namesake its body paired', () => {
    // The branch is inside the second effect, which pairs by its body; under
    // it the branch pairs by its address and keeps delta, rather than taking
    // the effect's beta as a region born in it would.
    expect(crossings(rerecordedNested(NESTED_SHIFTED), 'Widget/useEffect.arg0', 'if#0/then')).toEqual([[DELTA]]);
  });

  it('pairs a namesake inside a paired namesake by its address there, whatever its body', () => {
    // Under the second effect only one callback answers to `map.arg0`, so it
    // is that callback edited, not a namesake whose body went.
    const merged = rerecordedNested(NESTED_SHIFTED.replace('return x + 2;', 'return x + 3;'));

    expect(crossings(merged, 'Widget/useEffect.arg0/map.arg0')).toEqual([[DELTA], EVERY]);
  });

  it('carries nothing onto the regions inside a namesake paired with nothing, even a body one of them held', () => {
    // The third effect holds the callback body alpha entered in the first, but
    // which effect holds it is the question the effect's body did not answer:
    // the callback takes the crossings around it, not alpha's alone.
    expect(crossings(rerecordedNested(NESTED_SHIFTED), 'Widget/useEffect.arg0/map.arg0')).toEqual([[DELTA], EVERY]);
  });
});
