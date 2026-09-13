import type {
  AccessibilitySnapshot,
  RenderDocument,
  SemanticSnapshot,
} from '@variance-authority/core/format';
import { describe, expect, it } from 'vitest';
import { driftBetween, listDrift, type InPlaceReading } from './drift.js';

/**
 * The guard this backs refuses a subject, so its sentence is the whole report.
 *
 * Each case moves exactly one facet and asserts that facet is what the caller is
 * told to look at — a describer that named the wrong writer would send someone
 * hunting a theme transition for a poll that was still running.
 */

const VIEWPORT = { width: 200, height: 120, deviceScaleFactor: 1, colorScheme: 'light' } as const;

function documentOf(html: string): RenderDocument {
  return {
    documentVersion: 1,
    subject: { id: 'subject', kind: 'fixture' },
    html,
    frame: { html: {}, body: {}, ancestors: [] },
    css: [],
    viewport: VIEWPORT,
    inherited: {},
    fonts: [],
    diagnostics: [],
  };
}

function snapshotOf(structureHash: string, styleHash: string): SemanticSnapshot {
  return {
    formatVersion: 1,
    subject: { id: 'subject', kind: 'fixture' },
    profile: { level: 'exact' },
    environment: { viewport: VIEWPORT },
    renderHash: `${structureHash}/${styleHash}`,
    structureHash,
    styleHash,
    root: { path: '0', tag: 'div', attributes: {}, style: {}, children: [] },
  } as unknown as SemanticSnapshot;
}

function readingOf(overrides: Partial<InPlaceReading> = {}): InPlaceReading {
  return {
    document: documentOf('<div data-va-path="0">one</div>'),
    snapshot: snapshotOf('structure-a', 'style-a'),
    accessibility: { digest: 'aria-a' } as unknown as AccessibilitySnapshot,
    stabilization: { digest: 'hold-a' },
    ...overrides,
  };
}

describe('driftBetween', () => {
  it('says nothing when both readings agree', () => {
    expect(driftBetween(readingOf(), readingOf())).toEqual([]);
  });

  it('separates a render still running from a style still settling', () => {
    const structure = driftBetween(
      readingOf(),
      readingOf({ snapshot: snapshotOf('structure-b', 'style-a') }),
    );
    const style = driftBetween(
      readingOf(),
      readingOf({ snapshot: snapshotOf('structure-a', 'style-b') }),
    );

    expect(structure).toEqual(['DOM structure']);
    expect(style).toEqual(['applied style']);
  });

  it('names the part of the rendered document that moved', () => {
    const drifted = driftBetween(
      readingOf(),
      readingOf({ document: documentOf('<div data-va-path="0">two</div>') }),
    );

    expect(drifted).toEqual(['the subject markup']);
  });

  it('separates a late stylesheet from markup that is still committing', () => {
    const after = readingOf();
    const drifted = driftBetween(readingOf(), {
      ...after,
      document: { ...after.document, css: ['div { color: red }'] },
    });

    expect(drifted).toEqual(['the applied CSS']);
  });

  it('names the viewport when something resized the page under the capture', () => {
    const after = readingOf();
    const drifted = driftBetween(readingOf(), {
      ...after,
      document: { ...after.document, viewport: { ...VIEWPORT, width: 240 } },
    });

    expect(drifted).toEqual(['the viewport']);
  });

  it('names the accessibility tree and the hold apart from the pixels', () => {
    const drifted = driftBetween(
      readingOf(),
      readingOf({
        accessibility: { digest: 'aria-b' } as unknown as AccessibilitySnapshot,
        stabilization: { digest: 'hold-b' },
      }),
    );

    expect(drifted).toEqual(['the accessibility tree', 'the stabilization it needed']);
  });

  it('still reports content that moved outside both half-hashes', () => {
    const after = readingOf();
    const drifted = driftBetween(readingOf(), {
      ...after,
      snapshot: { ...after.snapshot, renderHash: 'render-b' } as SemanticSnapshot,
    });

    expect(drifted).toEqual(['subject content']);
  });

  it('lists every facet that moved, so one sentence covers the subject', () => {
    const drifted = driftBetween(
      readingOf(),
      readingOf({
        document: documentOf('<div data-va-path="0">two</div>'),
        snapshot: snapshotOf('structure-b', 'style-b'),
        accessibility: { digest: 'aria-b' } as unknown as AccessibilitySnapshot,
        stabilization: { digest: 'hold-b' },
      }),
    );

    expect(drifted).toEqual([
      'the subject markup',
      'DOM structure',
      'applied style',
      'the accessibility tree',
      'the stabilization it needed',
    ]);
  });
});

describe('listDrift', () => {
  it('reads a single facet as itself', () => {
    expect(listDrift(['the viewport'])).toBe('the viewport');
  });

  it('joins several so the message stays one sentence', () => {
    expect(listDrift(['the viewport', 'applied style', 'the accessibility tree'])).toBe(
      'the viewport, applied style and the accessibility tree',
    );
  });
});
