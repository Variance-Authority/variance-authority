// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { diffSnapshots, normalize, type SemanticSnapshot, type Viewport } from '@variance-authority/core';
import { collect } from '@variance-authority/collector-dom';
import { portalContentOf, provenanceOf } from '@variance-authority/provenance-react';
import { CONTESTED_CORPUS, SETTLED_CORPUS, type CorpusCase } from './corpus.js';
import { renderCase } from './render.js';

/**
 * M0's exit measurement.
 *
 * Every other test in this repository was written alongside the code it checks.
 * This one is different: the corpus declared its ground truth in `corpus.ts`
 * before the pipeline existed, so this file measures the normalizer against
 * expectations it did not author. That is the only arrangement in which the
 * numbers mean anything — a ruleset scored against expectations derived from its
 * own output scores 100% and proves nothing.
 *
 * Contested cases are run and reported but never counted. Reporting them as
 * passes or as failures would both hide the fact that nobody has decided.
 */

const VIEWPORT: Viewport = { width: 1280, height: 720, deviceScaleFactor: 1, colorScheme: 'light' };

let container: HTMLElement | null = null;
let dispose: (() => void) | null = null;

afterEach(() => {
  dispose?.();
  dispose = null;
  container?.remove();
  container = null;
  document.body.innerHTML = '';
});

function snapshotOf(subject: CorpusCase['subject'], variant: CorpusCase['baseVariant']): SemanticSnapshot {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.appendChild(host);

  const rendered = renderCase(host, subject, variant);
  const snapshot = normalize(
    collect(rendered.container, {
      subject: { id: `fixture:${subject}`, kind: 'fixture' },
      viewport: VIEWPORT,
      engine: 'jsdom@corpus',
      fonts: ['Inter/400/normal/corpus'],
      portalsOf: portalContentOf,
      // Without owner chains every delta lands in `unattributed`, and the
      // one-root-per-cause claim is untestable — the differ has nothing to group
      // by. Wiring it here is what makes P2 and P3 the same measurement.
      provenanceOf,
    }),
  );

  rendered.unmount();
  host.remove();
  return snapshot;
}

interface Outcome {
  readonly id: string;
  readonly expected: CorpusCase['expect'];
  readonly observed: 'hash-stable' | 'hash-changed';
  readonly agreed: boolean;
  readonly roots: number;
  readonly bands: readonly string[];
}

function run(corpusCase: CorpusCase): Outcome {
  const before = snapshotOf(corpusCase.subject, corpusCase.baseVariant);
  const after = snapshotOf(corpusCase.subject, corpusCase.perturbedVariant);
  const diff = diffSnapshots(before, after);

  const observed = diff.identical ? 'hash-stable' : 'hash-changed';

  return {
    id: corpusCase.id,
    expected: corpusCase.expect,
    observed,
    agreed: observed === corpusCase.expect,
    roots: diff.roots.length,
    bands: [...new Set(diff.deltas.map((delta) => delta.band))],
  };
}

describe('M0 — corpus agreement', () => {
  const outcomes: Outcome[] = [];

  for (const corpusCase of SETTLED_CORPUS) {
    it(`${corpusCase.id} — ${corpusCase.expect}`, () => {
      const outcome = run(corpusCase);
      outcomes.push(outcome);

      expect(
        outcome.observed,
        `${corpusCase.id}\n  expected: ${corpusCase.expect}\n  rationale: ${corpusCase.rationale}\n  defends: ${corpusCase.spec}`,
      ).toBe(corpusCase.expect);
    });
  }

  it('reports the measurement', () => {
    const stable = SETTLED_CORPUS.filter((c) => c.expect === 'hash-stable');
    const changed = SETTLED_CORPUS.filter((c) => c.expect === 'hash-changed');
    const missed = outcomes.filter((o) => !o.agreed);

    const falseStable = missed.filter((o) => o.observed === 'hash-stable');
    const falseChanged = missed.filter((o) => o.observed === 'hash-changed');

    console.log(
      [
        '',
        'M0 CORPUS MEASUREMENT',
        `  settled cases:        ${SETTLED_CORPUS.length}  (${stable.length} stable, ${changed.length} changed)`,
        `  contested (excluded): ${CONTESTED_CORPUS.length}`,
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
});

describe('M0 — one root per cause (claim P2)', () => {
  const withRootExpectation = SETTLED_CORPUS.filter((c) => c.roots !== undefined);

  for (const corpusCase of withRootExpectation) {
    it(`${corpusCase.id} — ${corpusCase.roots} root(s)`, () => {
      const outcome = run(corpusCase);
      expect(outcome.roots, `${corpusCase.id}: ${corpusCase.rationale}`).toBe(corpusCase.roots);
    });
  }
});

describe('M0 — contested cases', () => {
  // Run, reported, never asserted. The value is knowing what the current reading
  // produces, so that whoever settles the question argues against a real number.
  for (const corpusCase of CONTESTED_CORPUS) {
    it(`${corpusCase.id} — undecided`, () => {
      const outcome = run(corpusCase);
      console.log(
        `  contested ${corpusCase.id}: declared ${corpusCase.expect}, observed ${outcome.observed} — ${corpusCase.contested}`,
      );
      expect(outcome.observed).toMatch(/^hash-(stable|changed)$/);
    });
  }
});
