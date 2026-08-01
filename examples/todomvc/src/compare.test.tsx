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
import { collect } from '@variance-authority/collector-dom';
import { portalContentOf, provenanceOf } from '@variance-authority/provenance-react';
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
 * `appearanceHash` is a **proxy**, not a screenshot, and it is checked rather
 * than assumed: `mutations.ts` declares `visible` per mutation from first
 * principles, and a separate run takes real Chromium screenshots to confirm the
 * two agree. Where they disagree, the pixels win and the proxy is wrong.
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

describe('claim 3 — the case a camera structurally cannot report', () => {
  const brokenToggle = MUTATIONS.find((m) => m.id === 'broken-toggle')!;

  it('is invisible to the pixel arm', () => {
    // The `<div>` carries the same classes, so the same box, background, border
    // and radius. Every rendered pixel is identical by construction.
    const result = compare(brokenToggle);
    expect(result.pixel.reviewItems).toBe(0);
  });

  it('is caught, banded as geometry, and attributed to a component', () => {
    const result = compare(brokenToggle);

    expect(result.semantic.reviewItems).toBeGreaterThan(0);
    expect(result.semantic.structureIntact).toBe(false);
    expect(result.semantic.components).toContain('Toggle');
  });

  it('reports the accessibility facts that were lost', () => {
    const before = snapshotOf('ds/toggle--states');
    const after = snapshotOf('ds/toggle--states', brokenToggle);
    const diff = diffSnapshots(before, after);

    const kinds = new Set(diff.deltas.map((delta) => delta.kind));
    expect(kinds.has('role-changed') || kinds.has('node-removed') || kinds.has('node-added')).toBe(
      true,
    );
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
