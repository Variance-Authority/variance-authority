// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  diffSnapshots,
  loudestBand,
  type Band,
  type SemanticDiff,
} from '@variance-authority/core/compare';
import { buildDocket } from '@variance-authority/core/judge';
import { jsdomSnapshot } from './jsdom-profile.js';
import {
  CONTESTED_CORPUS,
  CORPUS,
  expectationFor,
  scorableFor,
  undecidableFor,
  type CorpusCase,
} from './corpus.js';

/**
 * M0's exit measurement, under `jsdom`.
 *
 * Every other test in this repository was written alongside the code it checks.
 * This one is different: the corpus declared its ground truth in `corpus.ts`
 * before the pipeline existed, so this file measures the normalizer against
 * expectations it did not author. That is the only arrangement in which the
 * numbers mean anything — a ruleset scored against expectations derived from its
 * own output scores 100% and proves nothing.
 *
 * Since ADR-0008 the denominator is a *per-profile* question. Contested cases are
 * run and reported but never counted; so are cases this profile declares itself
 * unable to decide, which is a different exclusion for a different reason and is
 * reported separately. Scoring an undecidable case either way would be
 * dishonest — as a pass it credits `jsdom` for an answer it reached by not
 * looking, as a miss it charges it for a limitation it declares up front.
 *
 * The `chromium` half lives in `measure.chromium.test.ts`, which also compares
 * the two profiles (claim P4).
 */

afterEach(() => {
  document.body.innerHTML = '';
});

interface Outcome {
  readonly id: string;
  readonly expected: CorpusCase['expect'];
  readonly observed: 'hash-stable' | 'hash-changed';
  readonly agreed: boolean;
  readonly roots: number;
  /** Loudest band present — what a blocking policy reads. */
  readonly band: Band | 'none';
  readonly bands: readonly Band[];
  /** Delta kinds observed, so a band disagreement names its own evidence. */
  readonly kinds: readonly string[];
  /** Who the report blames. See `CorpusCase.blames`. */
  readonly blames: readonly string[];
}

function run(corpusCase: CorpusCase): Outcome {
  const before = jsdomSnapshot(corpusCase.subject, corpusCase.baseVariant);
  const after = jsdomSnapshot(corpusCase.subject, corpusCase.perturbedVariant);
  const diff = diffSnapshots(before, after);

  const observed = diff.identical ? 'hash-stable' : 'hash-changed';
  const expectation = expectationFor(corpusCase, 'jsdom');
  const expected = expectation.kind === 'scorable' ? expectation.expect : corpusCase.expect;

  return {
    id: corpusCase.id,
    expected,
    observed,
    agreed: observed === expected,
    roots: diff.roots.length,
    band: loudestBand(diff.deltas.map((delta) => delta.band)) ?? 'none',
    bands: [...new Set(diff.deltas.map((delta) => delta.band))],
    kinds: [...new Set(diff.deltas.map((delta) => delta.kind))],
    blames: blamedBy(diff),
  };
}

/**
 * The names the report puts in front of a reviewer.
 *
 * Read from the docket rather than from the diff, because the docket is what a
 * reader is handed and the two can disagree — which is the whole reason this is
 * scored. A `token` root blames no component, so it carries its label instead.
 */
function blamedBy(diff: SemanticDiff): readonly string[] {
  return buildDocket([diff]).entries.flatMap((entry) => {
    const components = entry.components
      .filter((component) => component.role === 'root')
      .map((component) => component.name);

    return components.length > 0 ? components : [entry.label];
  });
}

const SCORABLE = scorableFor('jsdom');
const UNDECIDABLE = undecidableFor('jsdom');

describe('M0 — corpus agreement (jsdom)', () => {
  const outcomes: Outcome[] = [];

  for (const corpusCase of SCORABLE) {
    const expectation = expectationFor(corpusCase, 'jsdom');
    if (expectation.kind !== 'scorable') continue;

    it(`${corpusCase.id} — ${expectation.expect}`, () => {
      const outcome = run(corpusCase);
      outcomes.push(outcome);

      expect(
        outcome.observed,
        `${corpusCase.id}\n  expected: ${expectation.expect}\n  rationale: ${corpusCase.rationale}\n  defends: ${corpusCase.spec}`,
      ).toBe(expectation.expect);
    });
  }

  it('reports the measurement', () => {
    const missed = outcomes.filter((o) => !o.agreed);

    const falseStable = missed.filter((o) => o.observed === 'hash-stable');
    const falseChanged = missed.filter((o) => o.observed === 'hash-changed');

    const declared = (verdict: string): number =>
      SCORABLE.filter((c) => {
        const e = expectationFor(c, 'jsdom');
        return e.kind === 'scorable' && e.expect === verdict;
      }).length;

    console.log(
      [
        '',
        'M0 CORPUS MEASUREMENT — jsdom',
        `  scorable cases:       ${SCORABLE.length}  (${declared('hash-stable')} stable, ${declared('hash-changed')} changed)`,
        `  undecidable here:     ${UNDECIDABLE.length}   ${UNDECIDABLE.map((c) => c.id).join(', ')}`,
        `  contested (excluded): ${CONTESTED_CORPUS.length}   ${CONTESTED_CORPUS.map((c) => c.id).join(', ')}`,
        `  agreed:               ${outcomes.filter((o) => o.agreed).length}/${outcomes.length}`,
        `  false unchanged:      ${falseStable.length}   ${falseStable.map((o) => o.id).join(', ')}`,
        `  false changed:        ${falseChanged.length}   ${falseChanged.map((o) => o.id).join(', ')}`,
        '',
      ].join('\n'),
    );

    // A false `unchanged` is categorically worse than a false `changed`: one
    // hides a regression, the other costs a review. They are asserted separately
    // so a single pass rate can never average the fatal into the merely noisy.
    expect(falseStable, 'false unchanged — a missed regression').toEqual([]);
  });

  it.todo(
    'the false-alarm rate is scored against a target the way `false unchanged` is — needs no-op cases this corpus does not carry (a reindent inside a block, reordered imports, an extracted subcomponent), each admitted at 0 px by a published arbiter, so `false changed` has a denominator instead of a log line',
  );
});

describe('M0 — one root per cause (claim P2)', () => {
  for (const corpusCase of SCORABLE) {
    const expectation = expectationFor(corpusCase, 'jsdom');
    if (expectation.kind !== 'scorable' || expectation.roots === undefined) continue;

    it(`${corpusCase.id} — ${expectation.roots} root(s)`, () => {
      const outcome = run(corpusCase);
      expect(outcome.roots, `${corpusCase.id}: ${corpusCase.rationale}`).toBe(expectation.roots);
    });
  }
});

/**
 * The declared band, scored — the same block `measure.chromium.test.tsx` runs.
 *
 * Until the bands were split this field asserted nothing anywhere: five cases
 * changed band and no test noticed. A declaration the corpus makes in advance
 * and never checks is documentation that drifts, and the corpus's whole claim to
 * refute the implementation rests on its declarations being load-bearing.
 */
describe('M0 — declared bands (spec §5)', () => {
  for (const corpusCase of SCORABLE) {
    const expectation = expectationFor(corpusCase, 'jsdom');
    if (expectation.kind !== 'scorable' || expectation.band === undefined) continue;

    it(`${corpusCase.id} — ${expectation.band}`, () => {
      const outcome = run(corpusCase);

      // The delta kinds are in the message deliberately. "expected token,
      // observed geometry" does not say which evidence produced the answer.
      expect(
        outcome.band,
        `${corpusCase.id}: bands ${outcome.bands.join('+')} from ${outcome.kinds.join(', ')}\n  ` +
          (expectation.because ?? corpusCase.rationale),
      ).toBe(expectation.band);
    });
  }
});

/**
 * **Who the report blames**, which `roots` cannot check.
 *
 * A count of one is a count of one whichever component it names, so every case
 * here passed while a `prop` root was attributing to the component the pixels
 * moved in rather than to the one that passed the prop. That defect was found by
 * a test in `packages/dom`, which is the wrong place for it: this is the corpus's
 * claim, declared in advance, and it belongs here.
 */
describe('M0 — who the report blames (spec §6.2)', () => {
  for (const corpusCase of SCORABLE) {
    const expectation = expectationFor(corpusCase, 'jsdom');
    if (expectation.kind !== 'scorable' || expectation.blames === undefined) continue;

    it(`${corpusCase.id} — ${expectation.blames}`, () => {
      const outcome = run(corpusCase);

      expect(outcome.blames, `${corpusCase.id}: ${corpusCase.rationale}`).toEqual([
        expectation.blames,
      ]);
    });
  }
});

describe('M0 — excluded cases', () => {
  // Run, reported, never asserted. The value is knowing what the current reading
  // produces, so that whoever settles the question argues against a real number.
  for (const corpusCase of CORPUS) {
    const expectation = expectationFor(corpusCase, 'jsdom');
    if (expectation.kind === 'scorable') continue;

    it(`${corpusCase.id} — ${expectation.kind}`, () => {
      const outcome = run(corpusCase);
      console.log(
        `  ${expectation.kind} ${corpusCase.id}: declared ${corpusCase.expect}, observed ${outcome.observed} — ${expectation.reason}`,
      );
      expect(outcome.observed).toMatch(/^hash-(stable|changed)$/);
    });
  }
});
