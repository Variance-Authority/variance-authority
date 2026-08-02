// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  adjudicate,
  buildDocket,
  diffSnapshots,
  digestValue,
  normalize,
  summarizeAdjudication,
  type CanonicalValue,
  type SemanticDiff,
  type SemanticNode,
  type SemanticSnapshot,
  type Viewport,
} from '@variance-authority/core';
import { collect } from '@variance-authority/dom';
import { portalContentOf, provenanceOf } from '@variance-authority/react';
import { CHANGESETS, POLICY, changesetById, mutationsOf, type Changeset } from './changesets.js';
import { renderStory } from './render.js';
import { STORIES } from './stories.js';

/**
 * Reviewing a branch, rather than an edit.
 *
 * Everything else in this example applies one mutation at a time, which makes
 * every finding trivially findable. A branch carries several changes at once, and
 * that is the only condition under which the real question appears: **which of
 * these did I not mean to do?**
 *
 * The arithmetic is the argument. One accident among one deliberate change is
 * obvious. One accident among four, spread across twenty-odd changed
 * screenshots, is not — and a review that misses it is doing the only thing the
 * output permits.
 */

const VIEWPORT: Viewport = { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' };

let container: HTMLElement;

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => container.remove());

function snapshotOf(storyId: string, changeset?: Changeset): SemanticSnapshot {
  renderStory(container, storyId, changeset ? { mutations: mutationsOf(changeset) } : {});

  return normalize(
    collect(container, {
      subject: { id: storyId, kind: 'story' },
      viewport: VIEWPORT,
      engine: 'jsdom@changeset',
      fonts: ['system/400/normal/changeset'],
      provenanceOf,
      portalsOf: portalContentOf,
    }),
  );
}

/** See `compare.test.tsx`: what a camera records, and nothing it cannot sense. */
function appearanceHash(snapshot: SemanticSnapshot): string {
  const appearance = (node: SemanticNode): CanonicalValue => ({
    style: node.style,
    text: node.text,
    children: node.children.map(appearance),
  });
  return digestValue(appearance(snapshot.root));
}

interface Reviewed {
  /** Screenshots a pixel differ would put in front of a human. */
  readonly changedScreenshots: number;
  readonly result: ReturnType<typeof adjudicate>;
  readonly summary: string;
}

function review(changeset: Changeset): Reviewed {
  const diffs: SemanticDiff[] = [];
  let changedScreenshots = 0;

  for (const story of STORIES) {
    const before = snapshotOf(story.id);
    const beforeAppearance = appearanceHash(before);

    const after = snapshotOf(story.id, changeset);
    if (appearanceHash(after) !== beforeAppearance) changedScreenshots += 1;

    diffs.push(diffSnapshots(before, after));
  }

  const result = adjudicate(buildDocket(diffs), changeset.intent, POLICY);
  return { changedScreenshots, result, summary: summarizeAdjudication(result) };
}

// ===========================================================================

describe('a branch where everything was declared', () => {
  it('authorizes every root and reports nothing to review', () => {
    const reviewed = review(changesetById('rebrand'));

    expect(reviewed.result.verdict).toBe('authorized');
    expect(reviewed.result.needsReview).toBe(0);
    expect(reviewed.result.violations).toBe(0);
  });

  it('still changed a pile of screenshots', () => {
    // The point of the pair. Nothing here needs a human, and a pixel differ has
    // no way to know that — its output is the same shape either way.
    const reviewed = review(changesetById('rebrand'));
    expect(reviewed.changedScreenshots).toBeGreaterThan(5);
  });
});

describe('the same branch with one thing nobody meant to do', () => {
  const changeset = changesetById('rebrand-with-accident');

  it('finds exactly the undeclared change', () => {
    const reviewed = review(changeset);
    const flagged = reviewed.result.adjudications.filter((a) => a.verdict !== 'authorized');

    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.label).toBe('Toggle');
  });

  it('calls it a violation, because Toggle is protected', () => {
    // Protection is checked before the declaration, deliberately: a protected
    // component is protected *from* the person editing it, and letting a branch
    // authorize its own change to one would make the setting decorative.
    const reviewed = review(changeset);
    expect(reviewed.result.verdict).toBe('violation');
    expect(reviewed.result.violations).toBe(1);
  });

  it('leaves the declared changes silent', () => {
    const reviewed = review(changeset);
    expect(reviewed.result.authorized).toBe(3);
  });

  it('is indistinguishable from the clean branch to a pixel differ', () => {
    // Both branches change a similar pile of screenshots. Nothing in that number
    // says one of them contains an accessibility regression and the other does
    // not — which is the whole difficulty, stated as a measurement.
    const clean = review(changesetById('rebrand'));
    const accidental = review(changeset);

    expect(clean.changedScreenshots).toBeGreaterThan(5);
    expect(accidental.changedScreenshots).toBeGreaterThan(5);
    expect(clean.result.verdict).not.toBe(accidental.result.verdict);
  });
});

describe('an accident that changes no pixel at all', () => {
  const changeset = changesetById('density-pass-with-accident');

  it('finds it among four declared changes', () => {
    const reviewed = review(changeset);
    const flagged = reviewed.result.adjudications.filter((a) => a.verdict !== 'authorized');

    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.label).toBe('TextField');
    expect(flagged[0]!.verdict).toBe('needs-review');
  });

  it('says why, in a sentence that names the reach', () => {
    const reviewed = review(changeset);
    const flagged = reviewed.result.adjudications.find((a) => a.verdict !== 'authorized')!;

    expect(flagged.because).toContain('undeclared');
    expect(flagged.because).toContain('subject');
  });

  it('has no signal at all on the pixel arm for that change', () => {
    // The declared changes move plenty of pixels. The accident moves none — so
    // adding it to the branch does not change what a pixel differ reports.
    const withAccident = review(changeset);
    const without = review(changesetById('density-pass'));

    expect(withAccident.changedScreenshots).toBe(without.changedScreenshots);
    expect(without.result.verdict).toBe('authorized');
    expect(withAccident.result.verdict).toBe('needs-review');
  });
});

describe('a declaration that was true but under-scoped', () => {
  it('authorizes the change and questions its reach', () => {
    // "Tweak the accent on the primary button" is honest. The token is not
    // Button's, though, and the author has not looked at where else it lands.
    const reviewed = review(changesetById('understated-blast-radius'));
    const adjudication = reviewed.result.adjudications[0]!;

    expect(adjudication.verdict).toBe('needs-review');
    expect(adjudication.because).toContain('declared at most 2');
  });

  it('does not call it a violation', () => {
    // The change *is* the declared one. What failed is the estimate of its blast
    // radius, which is worth showing the author rather than blocking on.
    expect(review(changesetById('understated-blast-radius')).result.verdict).toBe('needs-review');
  });
});

describe('a declaration that did not happen', () => {
  it('reports the claim as undelivered', () => {
    // Easy to omit and worth surfacing: the edit was lost in a rebase, or the
    // declaration is stale. Both deserve a sentence before merge.
    const reviewed = review(changesetById('undelivered'));

    expect(reviewed.result.undelivered).toHaveLength(1);
    expect(reviewed.result.undelivered[0]!.root).toBe('token:--va-space-3');
    expect(reviewed.summary).toContain('undelivered');
  });
});

describe('the report a reviewer reads', () => {
  it('leads with the finding rather than the expected changes', () => {
    const reviewed = review(changesetById('density-pass-with-accident'));

    // Authorized roots collapse to a count. A report that lists four expected
    // changes above the one unexpected one has buried its only finding, which is
    // exactly what a screenshot gallery does.
    expect(reviewed.summary).toContain('3 authorized');
    expect(reviewed.summary).toContain('TextField');
    expect(reviewed.summary.split('\n').length).toBeLessThan(6);
  });

  it('prints the branch comparison', () => {
    const rows = CHANGESETS.map((changeset) => {
      const reviewed = review(changeset);
      const { result } = reviewed;

      return (
        `  ${changeset.id.padEnd(28)} ${String(reviewed.changedScreenshots).padStart(2)}` +
        `  ${String(result.adjudications.length).padStart(2)}` +
        `  ${String(result.authorized).padStart(2)}` +
        `  ${String(result.needsReview).padStart(2)}` +
        `  ${String(result.violations).padStart(2)}` +
        `   ${result.verdict}`
      );
    });

    console.log(
      [
        '',
        'BRANCH REVIEW — what a human is asked to look at',
        `  ${'changeset'.padEnd(28)} pix root auth rev vio   verdict`,
        `  ${'-'.repeat(66)}`,
        ...rows,
        '',
      ].join('\n'),
    );

    expect(rows).toHaveLength(CHANGESETS.length);
  });
});
