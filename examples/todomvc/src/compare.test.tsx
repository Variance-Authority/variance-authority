// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  buildDocket,
  diffSnapshots,
  digestValue,
  normalize,
  summarize,
  type CanonicalValue,
  type SemanticDiff,
  type SemanticNode,
  type SemanticSnapshot,
  type Viewport,
} from '@variance-authority/core';
import { collect } from '@variance-authority/dom';
import { portalContentOf, provenanceOf } from '@variance-authority/react';
import { MUTATIONS, type Mutation } from './mutations.js';
import { renderStory } from './render.js';
import { STORIES } from './stories.js';

/**
 * The head-to-head.
 *
 * A claim that one approach beats another is worth nothing unless the loser is
 * implemented fairly, so the comparison arm here is a *generous* model of a pixel
 * differ: it sees everything a camera sees — every resolved style value, every
 * character of text, the full arrangement of boxes — and nothing a camera does
 * not. No roles, no accessible names, no states, no attributes, no ids.
 *
 * That last clause is the whole argument, and it is a statement about cameras
 * rather than about any particular tool. A screenshot cannot record that a
 * control has a role, and no threshold, algorithm, or amount of compute recovers
 * information the sensor never captured.
 *
 * `appearanceHash` is a **proxy**, not a screenshot, and checking it against real
 * Chromium screenshots found it wrong — so the limit is stated here rather than
 * discovered again.
 *
 * The proxy models what an author *declares* about a box. It does not model what
 * an engine *paints*, and native form controls are painted by the engine: under
 * `appearance: auto` a checkbox gets a platform widget with its own fill,
 * checkmark and margin, and the author's rules barely participate. So the proxy
 * reports `broken-toggle` as invisible while the camera measures 5482 differing
 * pixels across six stories.
 *
 * The proxy is therefore **optimistic for the pixel arm's blind spots**: where it
 * says "invisible" it may be under-reporting. That direction matters, because it
 * means the comparison below understates rather than overstates how often pixels
 * see something — the honest direction for a table we are using to argue against
 * them. `label-detached` is the case that needs no argument at all: only an
 * attribute value changes, and the real pixel arm measures zero.
 */

const VIEWPORT: Viewport = { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' };

let container: HTMLElement;

beforeEach(() => {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

function snapshotOf(storyId: string, mutation?: Mutation): SemanticSnapshot {
  renderStory(container, storyId, mutation ? { mutation } : {});

  return normalize(
    collect(container, {
      subject: { id: storyId, kind: 'story' },
      viewport: VIEWPORT,
      engine: 'jsdom@compare',
      fonts: ['system/400/normal/compare'],
      provenanceOf,
      portalsOf: portalContentOf,
    }),
  );
}

/**
 * What a camera would record: resolved style, text, and arrangement.
 *
 * Deliberately generous to the pixel arm — it is given the *resolved* values,
 * which a real differ must infer from pixels and often cannot. What it is not
 * given is anything a camera cannot sense.
 */
function appearanceHash(snapshot: SemanticSnapshot): string {
  const appearance = (node: SemanticNode): CanonicalValue => ({
    style: node.style,
    text: node.text,
    children: node.children.map(appearance),
  });

  return digestValue(appearance(snapshot.root));
}

interface Arm {
  /** Subjects the arm reports as changed. For a pixel differ this is its output. */
  readonly changed: readonly string[];
  /** Distinct things a human must adjudicate. */
  readonly reviewItems: number;
}

interface Comparison {
  readonly mutation: Mutation;
  readonly pixel: Arm;
  readonly semantic: Arm & {
    readonly rootLabels: readonly string[];
    readonly rootKinds: readonly string[];
    readonly impact: string;
    readonly components: readonly string[];
    readonly structureIntact: boolean;
    readonly summary: string;
  };
  readonly screenshotsPixelArm: number;
  readonly screenshotsThisTool: number;
}

function compare(mutation: Mutation): Comparison {
  const diffs: SemanticDiff[] = [];
  const pixelChanged: string[] = [];

  for (const story of STORIES) {
    const before = snapshotOf(story.id);
    const beforeAppearance = appearanceHash(before);

    const after = snapshotOf(story.id, mutation);
    const afterAppearance = appearanceHash(after);

    if (beforeAppearance !== afterAppearance) pixelChanged.push(story.id);
    diffs.push(diffSnapshots(before, after));
  }

  const docket = buildDocket(diffs);

  // A screenshot is needed only where the semantic stage could not explain the
  // change. A pixel differ has no such stage, so it photographs everything, on
  // both sides, every build.
  const unexplained = diffs.filter((diff) =>
    diff.roots.some((root) => root.kind === 'unattributed'),
  ).length;

  return {
    mutation,
    pixel: { changed: pixelChanged, reviewItems: pixelChanged.length },
    semantic: {
      changed: diffs.filter((diff) => !diff.identical).map((diff) => diff.subjectId),
      reviewItems: docket.entries.length,
      rootLabels: docket.entries.map((entry) => entry.label),
      rootKinds: docket.entries.map((entry) => entry.kind),
      impact: docket.entries.map((entry) => entry.impact).join('+') || 'none',
      components: docket.entries.flatMap((entry) => entry.components.map((c) => c.name)),
      structureIntact: docket.entries.every((entry) => entry.structureIntact),
      summary: summarize(docket),
    },
    screenshotsPixelArm: STORIES.length * 2,
    screenshotsThisTool: unexplained,
  };
}

// ===========================================================================

describe('what each arm reports, mutation by mutation', () => {
  const results: Comparison[] = [];

  for (const mutation of MUTATIONS) {
    it(`${mutation.id} — ${mutation.intent}`, () => {
      const result = compare(mutation);
      results.push(result);

      expect(result.semantic.reviewItems).toBe(mutation.expect.roots);

      if (mutation.expect.roots > 0) {
        expect(result.semantic.rootKinds).toContain(mutation.expect.rootKind);
        expect(result.semantic.impact).toContain(mutation.expect.impact);
        expect(result.semantic.structureIntact).toBe(mutation.expect.structureIntact);
      }
    });
  }

  it('prints the comparison', () => {
    const rows = results.map((result) => {
      const pixel = `${result.pixel.reviewItems}`.padStart(2);
      const semantic = `${result.semantic.reviewItems}`.padStart(2);
      const cause =
        result.semantic.rootLabels.length > 0 ? result.semantic.rootLabels.join(', ') : '—';

      return (
        `  ${result.mutation.id.padEnd(17)} ${result.mutation.layer.padEnd(14)} ` +
        `${pixel} vs ${semantic}   ${result.semantic.impact.padEnd(10)} ${cause}`
      );
    });

    console.log(
      [
        '',
        'HEAD TO HEAD — review items a human must adjudicate',
        `  ${'mutation'.padEnd(17)} ${'layer'.padEnd(14)} pix  ours  ${'impact'.padEnd(10)} cause`,
        `  ${'-'.repeat(78)}`,
        ...rows,
        '',
        `  screenshots per build — pixel arm: ${STORIES.length * 2} per mutation, always`,
        `  screenshots per build — this tool: ${results.reduce((sum, r) => sum + r.screenshotsThisTool, 0)} across all ${MUTATIONS.length} mutations`,
        '',
      ].join('\n'),
    );

    expect(results).toHaveLength(MUTATIONS.length);
  });
});

// ===========================================================================

describe('claim 1 — one cause is one review item', () => {
  it('collapses a foundation change reaching every story into a single entry', () => {
    const result = compare(MUTATIONS.find((m) => m.id === 'token-accent')!);

    expect(result.pixel.reviewItems).toBeGreaterThan(4);
    expect(result.semantic.reviewItems).toBe(1);
    expect(result.semantic.rootLabels).toEqual(['--va-color-accent']);
  });

  it('names the token, not the stories it reached', () => {
    // A pixel differ's output is a list of files. Ours is the edit that caused
    // them, which is the thing an approval should be recorded against — an
    // approved token stays approved when a new story starts consuming it.
    const result = compare(MUTATIONS.find((m) => m.id === 'token-radius')!);

    // Two tokens moved, so two roots — one edit is not always one cause, and a
    // docket that merged them would claim a shared cause that does not exist.
    expect(new Set(result.semantic.rootKinds)).toEqual(new Set(['token']));
    expect(result.semantic.rootLabels).toContain('--va-radius-md');
  });
});

describe('claim 2 — layout and styling are told apart', () => {
  it('reports a colour token as paint: nothing can have moved', () => {
    const result = compare(MUTATIONS.find((m) => m.id === 'token-accent')!);
    expect(result.semantic.impact).toBe('paint');
  });

  it('reports a spacing token as layout, without a layout engine', () => {
    const result = compare(MUTATIONS.find((m) => m.id === 'token-space')!);
    expect(result.semantic.impact).toBe('layout');
  });

  it('reports a type-scale change as layout, not as styling', () => {
    // The one teams get wrong. Font size changes glyph advances, so it resizes
    // boxes and reflows everything after — filing it under "styling" mis-sells
    // the risk of the change.
    const result = compare(MUTATIONS.find((m) => m.id === 'token-type-scale')!);
    expect(result.semantic.impact).toBe('layout');
  });

  it('gives a pixel differ no way to make the same distinction', () => {
    // Both arrive as "these N screenshots differ". The information needed to
    // separate them is the property that changed, which the image does not carry.
    const paint = compare(MUTATIONS.find((m) => m.id === 'token-accent')!);
    const layout = compare(MUTATIONS.find((m) => m.id === 'token-space')!);

    expect(paint.semantic.impact).not.toBe(layout.semantic.impact);
    expect(paint.pixel.reviewItems).toBeGreaterThan(0);
    expect(layout.pixel.reviewItems).toBeGreaterThan(0);
  });
});

describe('claim 3 — the defect a camera cannot report', () => {
  const detached = MUTATIONS.find((m) => m.id === 'label-detached')!;

  it('cannot move a pixel, and does not', () => {
    // No argument about painting required: the only thing that changes is an
    // attribute value. The label renders identically, the input renders
    // identically, and the box tree is untouched. Confirmed at 0 differing
    // pixels by the real Chromium arm.
    expect(compare(detached).pixel.reviewItems).toBe(0);
  });

  it('is caught and attributed to the component that broke it', () => {
    const result = compare(detached);

    expect(result.semantic.reviewItems).toBeGreaterThan(0);
    expect(result.semantic.components).toContain('TextField');
  });

  it('names the accessible name that was lost', () => {
    const before = snapshotOf('ds/field--empty');
    const after = snapshotOf('ds/field--empty', detached);
    const diff = diffSnapshots(before, after);

    // The field stops being labelled. That is the regression, and it is the kind
    // of fact an image does not carry.
    expect(diff.deltas.some((delta) => delta.kind === 'name-changed')).toBe(true);
  });

  it('reports the dangling reference as a diagnostic, not silently', () => {
    const after = snapshotOf('ds/field--empty', detached);

    expect(after.diagnostics.some((d) => d.code === 'dangling-id-reference')).toBe(true);
  });
});

describe('claim 3b — what a camera sees but cannot classify', () => {
  // The weaker, surviving form of a claim that was originally overstated.
  // `broken-toggle` *is* visible — real screenshots measure 5482 differing pixels
  // across six stories, because an `<input type="checkbox">` is painted by the
  // engine and a `<div>` is not. What a pixel differ cannot do is say what it is
  // looking at.
  const brokenToggle = MUTATIONS.find((m) => m.id === 'broken-toggle')!;

  it('is one root, named, and flagged as structural', () => {
    const result = compare(brokenToggle);

    expect(result.semantic.reviewItems).toBe(1);
    expect(result.semantic.components).toContain('Toggle');
    expect(result.semantic.structureIntact).toBe(false);
  });

  it('is separated from a colour change, which a screenshot count cannot be', () => {
    // Six changed screenshots from an accessibility regression look exactly like
    // six changed screenshots from a rebrand. Here one is `structural` and rooted
    // at a component; the other is `paint` and rooted at a token.
    const paint = compare(MUTATIONS.find((m) => m.id === 'token-accent')!);

    expect(compare(brokenToggle).semantic.impact).toBe('structural');
    expect(paint.semantic.impact).toBe('paint');
    expect(paint.semantic.rootKinds).toEqual(['token']);
  });
});

describe('claim 4 — a no-op refactor is free on both arms', () => {
  // Conceded openly. Pixel differs handle this case perfectly well, and a
  // comparison that pretended otherwise would be worth ignoring. The claim here
  // is parity, not advantage — what differs is the price, below.
  const noop = MUTATIONS.find((m) => m.id === 'noop-refactor')!;

  it('changes nothing on either arm', () => {
    const result = compare(noop);

    expect(result.pixel.reviewItems).toBe(0);
    expect(result.semantic.reviewItems).toBe(0);
  });

  it('survives wrapper insertion, class churn, and generated-id renumbering', () => {
    const result = compare(noop);
    expect(result.semantic.changed).toEqual([]);
  });
});

describe('claim 5 — a page change is not a design-system change', () => {
  it('attributes a filter reorder to the page, touching no other story', () => {
    const result = compare(MUTATIONS.find((m) => m.id === 'filter-reorder')!);

    // Only the stories that render the footer. A foundation change reaches
    // everything; this reaches two. The pixel arm sees both as "some screenshots
    // differ" and cannot say which kind of edit it was looking at.
    expect(result.semantic.changed.length).toBeLessThan(STORIES.length);
    expect(result.semantic.structureIntact).toBe(false);
  });

  it('attributes a design-system edit to the component, not to the pages', () => {
    const result = compare(MUTATIONS.find((m) => m.id === 'button-padding')!);

    expect(result.semantic.rootKinds).toContain('component');
    expect(result.semantic.components).toContain('Button');
  });
});

describe('claim 6 — the cost', () => {
  it('takes no screenshots for changes it can explain', () => {
    let taken = 0;
    for (const mutation of MUTATIONS) taken += compare(mutation).screenshotsThisTool;

    // A pixel differ photographs every story on both sides of every build. This
    // photographs only what the semantic stage could not account for.
    expect(taken).toBe(0);
  });

  it('would have cost a pixel differ every story, twice, every time', () => {
    expect(compare(MUTATIONS[0]!).screenshotsPixelArm).toBe(STORIES.length * 2);
  });
});
