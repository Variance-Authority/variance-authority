import { describe, expect, it } from 'vitest';
import {
  accessibilitySnapshot,
  CHROMIUM_PROFILE,
  JSDOM_PROFILE,
  type RawCapture,
  type RawNode,
  type Rect,
} from '@variance-authority/core';
import { analyzePresentation } from './analyze.js';
import { comparePresentation } from './compare.js';
import { presentationSignal } from './report.js';

describe('presentation intelligence', () => {
  it('keeps unobserved layout distinct from observed empty ARIA', () => {
    const capture = rawCapture(node('main', undefined, [], { role: null, name: null }), false);
    const accessibility = accessibilitySnapshot('chromium@test', ['']);
    const report = analyzePresentation(capture, { accessibility });

    expect(report.semantic.anchors).toEqual([]);
    expect(report.semantic.browserAccessibility?.roots).toEqual(['']);
    expect(report.findings).toBeUndefined();
    expect(report.patterns).toBeUndefined();
    expect(report.telemetry.content.elements).toBe(1);
  });

  it('carries the font identities the caller established, and only when there are some', () => {
    // The live entry takes a `fonts` option and threads it into the capture,
    // then analyzes the capture and drops it. Whatever the caller pinned has to
    // arrive on the report or that option buys them nothing at all through the
    // door they actually use.
    const root = node('main', undefined, [], { role: null, name: null });
    const none = analyzePresentation(rawCapture(root, false));
    const pinned = analyzePresentation(withFonts(rawCapture(root, false), ['Inter/400/normal/deadbeef']));
    const substituted = analyzePresentation(withFonts(rawCapture(root, false), ['Inter/400/normal/cafebabe']));

    expect(none.fonts).toBeUndefined();
    expect(pinned.fonts).toEqual(['Inter/400/normal/deadbeef']);
    // A substitution moves every metric on the page without changing a byte of
    // code, so the reading is a different reading and its digest says so. The
    // content identity is what has to survive presentation moving, so it holds.
    expect(substituted.digest).not.toBe(pinned.digest);
    expect(substituted.contentDigest).toBe(pinned.contentDigest);
  });

  it('does not make the order a caller listed fonts in part of the reading', () => {
    const root = node('main', undefined, [], { role: null, name: null });
    const asWritten = ['b/700/italic/2222', 'a/400/normal/1111'];
    const reordered = ['a/400/normal/1111', 'b/700/italic/2222'];

    expect(analyzePresentation(withFonts(rawCapture(root, false), asWritten)).digest).toBe(
      analyzePresentation(withFonts(rawCapture(root, false), reordered)).digest,
    );
  });

  it('makes absent, empty, and partial ARIA separately sensitive report identities', () => {
    const capture = rawCapture(node('main', undefined, [], { role: null, name: null }), false);
    const absent = analyzePresentation(capture);
    const empty = analyzePresentation(capture, {
      accessibility: accessibilitySnapshot('chromium@test', ['']),
    });
    const partial = analyzePresentation(capture, {
      accessibility: accessibilitySnapshot('chromium@test', ['- button "Continue"']),
    });

    expect(new Set([absent.digest, empty.digest, partial.digest])).toHaveLength(3);
    expect(empty.semantic.browserAccessibility?.roots).toEqual(['']);
    expect(partial.semantic.browserAccessibility?.roots).toEqual(['- button "Continue"']);
  });

  it('treats dense, coherent presentation as telemetry rather than a defect', () => {
    const report = analyzePresentation(rawCapture(records({ between: 8, internal: 4, count: 6 })));

    expect(report.telemetry.density?.repeatedObjectsPerViewport).toBeGreaterThan(0);
    expect(report.patterns?.[0]?.instances).toHaveLength(6);
    expect(report.findings).toEqual([]);
  });

  it('reports collapsed between-object and within-object relationships', () => {
    const report = analyzePresentation(rawCapture(records({ between: 4, internal: 4, count: 6, flat: true })));
    const rules = report.findings?.map((finding) => finding.rule);

    expect(rules).toContain('SEPARATION_COLLISION');
    expect(rules).toContain('SPACING_RELATION_COLLISION');
    expect(rules).toContain('REPETITION_GRAMMAR_COLLAPSE');
    expect(rules).toContain('PROMINENCE_COLLAPSE');
    expect(report.findings?.filter((finding) => finding.pattern).every((finding) => finding.owner === 'r0:0'))
      .toBe(true);
    expect(report.findings?.filter((finding) => finding.rule === 'PROMINENCE_COLLAPSE'))
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ owner: 'r0:0/0' }),
      ]));
  });

  it('reports a leading structural label spaced like the body peers it introduces', () => {
    const report = analyzePresentation(rawCapture(structuredRecords({ leading: 4, peer: 4 })));
    const finding = report.findings?.find((candidate) => candidate.rule === 'SPACING_HIERARCHY_COLLISION');

    expect(finding).toEqual(expect.objectContaining({
      owner: 'r0:0',
      measurements: expect.objectContaining({
        leadingToBodyGapMedianPx: 4,
        bodyToBodyGapMedianPx: 4,
        ratio: 1,
      }),
    }));
    const paint = report.paint?.filter((instruction) => instruction.finding === finding?.id);
    expect(paint?.every((instruction) => instruction.shape === 'line')).toBe(true);
    expect(paint?.map((instruction) => instruction.label)).toEqual(expect.arrayContaining([
      'leading→body 4px',
      'body→body 4px',
    ]));
  });

  it('keeps a leading structural label distinct when its body relation has its own spacing', () => {
    const report = analyzePresentation(rawCapture(structuredRecords({ leading: 2, peer: 8 })));

    expect(report.findings?.some((candidate) => candidate.rule === 'SPACING_HIERARCHY_COLLISION')).toBe(false);
  });

  it('compares prominence among structural peers rather than ancestors and descendants', () => {
    const report = analyzePresentation(rawCapture(node(
      'main',
      rect(0, 0, 400, 160),
      [node(
        'h1',
        rect(0, 0, 400, 80),
        [node('span', rect(0, 0, 400, 40), [text('Same treatment')], { role: null, name: null })],
        { role: 'heading', name: 'Same treatment' },
      )],
      { role: 'main', name: 'Reading' },
    )));

    expect(report.findings?.some((finding) => finding.rule === 'PROMINENCE_COLLAPSE')).toBe(false);
  });

  it('records large margins without inventing a utilization finding', () => {
    const root = node(
      'main',
      rect(256, 0, 512, 900),
      [node('p', rect(256, 0, 512, 80), [text('A long document remains required.')], { role: null, name: null })],
      { role: 'main', name: 'Reading' },
    );
    const report = analyzePresentation(rawCapture(root));

    expect(report.telemetry.utilization?.horizontal).toBe(0.5);
    expect(report.findings).toEqual([]);
  });

  it('finds a surface whose paint is indistinguishable from its container', () => {
    const parentFill = 'rgb(23, 97, 211)';
    const childFill = 'rgb(23, 105, 224)';
    const root = node(
      'section',
      rect(0, 0, 400, 200),
      [
        node('button', rect(20, 20, 120, 36), [text('Continue')], { role: 'button', name: 'Continue' }, {
          'background-color': childFill,
        }),
      ],
      { role: 'region', name: 'Actions' },
      { 'background-color': parentFill },
    );
    const finding = analyzePresentation(rawCapture(root)).findings?.find(
      (candidate) => candidate.rule === 'SURFACE_COLLISION',
    );

    expect(finding?.measurements.perceptualDifference).toBeLessThan(8);
  });

  it('finds repeated alignment and inferred-baseline outliers', () => {
    const rows = Array.from({ length: 6 }, (_, index) => {
      const y = index * 44;
      const outlier = index === 4;
      return node(
        'article',
        rect(0, y, 280, 36),
        [
          node('span', rect(8, y + 8, 80, 20), [text(`Item ${index}`)], { role: null, name: null }),
          node(
            'button',
            rect(outlier ? 206 : 200, y + (outlier ? 13 : 8), 72, 20),
            [text('Open')],
            { role: 'button', name: 'Open' },
          ),
        ],
        { role: 'article', name: `Item ${index}` },
      );
    });
    const report = analyzePresentation(rawCapture(node('main', rect(0, 0, 280, 256), rows, { role: 'main', name: 'Items' })));
    const rules = report.findings?.map((finding) => finding.rule);

    expect(rules).toContain('ALIGNMENT_OUTLIER');
    expect(rules).toContain('BASELINE_DRIFT');
  });

  it('retains state-explained variance without calling it grammar drift', () => {
    const rows = Array.from({ length: 4 }, (_, index) => {
      const failed = index === 2;
      return node(
        'article',
        rect(0, index * 48, 300, 40),
        [node('span', rect(8, index * 48 + 10, 120, 20), [text('Status')], { role: null, name: null })],
        { role: 'article', name: `Run ${index}`, state: failed ? { invalid: true } : {} },
        failed ? { 'background-color': 'rgb(255, 230, 230)' } : {},
      );
    });
    const report = analyzePresentation(rawCapture(node('main', rect(0, 0, 300, 184), rows, { role: 'main', name: 'Runs' })));
    const pattern = report.patterns?.find((candidate) => candidate.instances.length === 4);

    expect(pattern?.outliers).toEqual([
      expect.objectContaining({ explainedByState: true }),
    ]);
    expect(report.findings?.some((finding) => finding.rule === 'PRESENTATION_GRAMMAR_DRIFT')).toBe(false);
  });

  it('compares relationship findings while proving information was preserved', () => {
    const before = analyzePresentation(rawCapture(records({ between: 4, internal: 4, count: 6, flat: true })));
    const after = analyzePresentation(rawCapture(records({ between: 12, internal: 4, count: 6 })));
    const comparison = comparePresentation(before, after);

    expect(comparison.findings?.find((row) => row.rule === 'SEPARATION_COLLISION')).toEqual(
      expect.objectContaining({ before: 1, after: 0, delta: -1 }),
    );
    expect(comparison.information.elements.before).toBe(comparison.information.elements.after);
    expect(comparison.information.characters.before).toBe(comparison.information.characters.after);
    expect(comparison.information.content.preserved).toBe(true);
  });

  it('does not mistake equal information counts for preserved content', () => {
    const reading = (value: string) => analyzePresentation(rawCapture(node(
      'main',
      undefined,
      [node('p', undefined, [text(value)], { role: null, name: null })],
      { role: 'main', name: 'Reading' },
    ), false));
    const comparison = comparePresentation(reading('Alpha'), reading('Omega'));

    expect(comparison.information.characters.before).toBe(comparison.information.characters.after);
    expect(comparison.information.content.preserved).toBe(false);
  });

  it('records introduced and resolved presentation consequences independently of a verdict', () => {
    const clean = analyzePresentation(rawCapture(records({ between: 12, internal: 4, count: 6 })));
    const collapsed = analyzePresentation(rawCapture(records({ between: 4, internal: 4, count: 6, flat: true })));

    const introduced = presentationSignal(clean, collapsed);
    const resolved = presentationSignal(collapsed, clean);

    expect(introduced.verdict).toBe('changed');
    expect(introduced.verdict === 'changed' && introduced.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ transition: 'introduced' })]),
    );
    expect(resolved.verdict === 'changed' && resolved.effects).toEqual(
      expect.arrayContaining([expect.objectContaining({ transition: 'resolved' })]),
    );
  });

  it('keeps unobserved layout incomparable instead of reporting an empty effect list', () => {
    const withoutLayout = analyzePresentation(rawCapture(
      node('main', undefined, [text('Reading')], { role: 'main', name: 'Reading' }),
      false,
    ));
    const withLayout = analyzePresentation(rawCapture(records({ between: 12, internal: 4, count: 6 })));

    expect(presentationSignal(withoutLayout, withLayout)).toEqual(expect.objectContaining({
      verdict: 'incomparable',
      because: expect.stringContaining('baseline'),
    }));
  });
});

function records(options: {
  readonly between: number;
  readonly internal: number;
  readonly count: number;
  readonly flat?: boolean;
}): RawNode {
  const height = 16 + options.internal + 16;
  const children = Array.from({ length: options.count }, (_, index) => {
    const y = index * (height + options.between);
    const headingStyle = options.flat ? {} : { 'font-size': '18px', 'font-weight': '700' };
    return node(
      'article',
      rect(0, y, 320, height),
      [
        node('h3', rect(0, y, 160, 16), [text('WHO')], { role: 'heading', name: 'WHO' }, headingStyle),
        node('p', rect(0, y + 16 + options.internal, 240, 16), [text(`Demand ${index}`)], { role: null, name: null }),
      ],
      { role: 'article', name: `Demand ${index}` },
    );
  });
  const total = options.count * height + (options.count - 1) * options.between;
  return node('main', rect(0, 0, 320, total), children, { role: 'main', name: 'Demands' });
}

function structuredRecords(options: { readonly leading: number; readonly peer: number }): RawNode {
  const records = Array.from({ length: 4 }, (_, index) => {
    const top = index * 180;
    const labelHeight = 16;
    const bodyHeight = 32;
    const firstBody = top + labelHeight + options.leading;
    return node(
      'article',
      rect(0, top, 320, 160),
      [
        node('span', rect(0, top, 320, labelHeight), [text(`Document ${index}`)], { role: null, name: null }, {
          'font-weight': '600',
        }),
        ...Array.from({ length: 3 }, (_, bodyIndex) => node(
          'div',
          rect(0, firstBody + bodyIndex * (bodyHeight + options.peer), 320, bodyHeight),
          [text(`Field ${bodyIndex}`)],
          { role: null, name: null },
        )),
      ],
      { role: 'article', name: `Record ${index}` },
    );
  });
  return node('main', rect(0, 0, 320, 700), records, { role: 'main', name: 'Records' });
}

function withFonts(capture: RawCapture, fonts: readonly string[]): RawCapture {
  return { ...capture, environment: { ...capture.environment, fonts } };
}

function rawCapture(root: RawNode, layout = true): RawCapture {
  return {
    captureVersion: 1,
    subject: { id: 'fixture:presentation', kind: 'fixture' },
    profile: layout ? CHROMIUM_PROFILE : JSDOM_PROFILE,
    environment: {
      profile: layout ? 'chromium' : 'jsdom',
      engine: layout ? 'chromium@test' : 'jsdom@test',
      viewport: { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' },
      fonts: [],
      conditions: {},
      assets: {},
    },
    root,
    inheritedSeed: {},
    diagnostics: [],
  };
}

function node(
  tag: string,
  box: Rect | undefined,
  children: readonly RawNode[],
  aria: RawNode['aria'],
  style: Readonly<Record<string, string>> = {},
): RawNode {
  const baseStyle = {
    'font-family': 'Arial',
    'font-size': '14px',
    'font-weight': '400',
    'font-style': 'normal',
    'line-height': '16px',
    color: 'rgb(20, 20, 20)',
    ...style,
  };
  return {
    tag,
    attributes: {},
    aria,
    matchedRules: [],
    computedStyle: baseStyle,
    ...(box === undefined ? {} : { rect: box }),
    children,
  };
}

function text(value: string): RawNode {
  return { tag: '#text', attributes: {}, matchedRules: [], text: value, children: [] };
}

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}
