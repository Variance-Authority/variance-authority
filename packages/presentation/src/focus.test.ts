import { describe, expect, it } from 'vitest';
import {
  CHROMIUM_PROFILE,
  type RawCapture,
  type RawNode,
  type Rect,
} from '@variance-authority/core';
import { analyzePresentation, focusPresentation } from './index.js';

describe('presentation focus', () => {
  it('keeps nested box evidence out of an owner reading and available to a subtree reading', () => {
    const report = analyzePresentation(capture(composition()));
    const compositionFocus = focusPresentation(report, 'r0:0', {
      paint: ['repetition', 'findings'],
    });
    const contentFocus = focusPresentation(report, 'r0:0/0', {
      paint: ['repetition', 'findings'],
    });
    const listFocus = focusPresentation(report, 'r0:0/1/1', {
      paint: ['repetition', 'findings'],
    });
    const oneFinding = focusPresentation(report, 'r0:0/1/1', {
      findings: [listFocus.findings[0]!.id],
      paint: ['findings'],
    });
    const holistic = focusPresentation(report, 'r0:0', { depth: 'subtree' });

    expect(compositionFocus.nodes.map((node) => node.id)).toEqual(['r0:0', 'r0:0/0', 'r0:0/1']);
    expect(compositionFocus.findings).toEqual([]);
    expect(compositionFocus.nested.findings).toBeGreaterThan(0);
    expect(compositionFocus.paint).toEqual([]);
    expect(contentFocus.findings).toEqual([
      expect.objectContaining({ rule: 'PRESENTATION_GRAMMAR_DRIFT', owner: 'r0:0/0' }),
    ]);
    expect(listFocus.patterns).toEqual([
      expect.objectContaining({ parent: 'r0:0/1/1', instances: expect.any(Array) }),
    ]);
    expect(listFocus.patterns[0]?.instances).toHaveLength(5);
    expect(listFocus.findings.map((finding) => finding.rule)).toEqual(expect.arrayContaining([
      'REPETITION_GRAMMAR_COLLAPSE',
      'SEPARATION_COLLISION',
      'SPACING_RELATION_COLLISION',
    ]));
    expect(listFocus.paint.every((instruction) => instruction.owner === 'r0:0/1/1')).toBe(true);
    expect(oneFinding.findings).toEqual([listFocus.findings[0]]);
    expect(oneFinding.paint.length).toBeGreaterThan(0);
    expect(oneFinding.paint.every((instruction) => instruction.finding === listFocus.findings[0]!.id)).toBe(true);
    expect(holistic.findings).toEqual(report.findings);
    expect(holistic.nested.findings).toBe(report.findings?.length);
  });

  it('refuses an owner that the report did not observe', () => {
    const report = analyzePresentation(capture(composition()));

    expect(() => focusPresentation(report, 'r0:missing')).toThrow(
      `presentation owner r0:missing is not in report ${report.digest}`,
    );
  });

  it('refuses a finding from a nested owner when focus remains at the parent box', () => {
    const report = analyzePresentation(capture(composition()));
    const nested = report.findings?.find((finding) => finding.owner === 'r0:0/1/1');

    expect(() => focusPresentation(report, 'r0:0', { findings: [nested!.id] })).toThrow(
      `presentation finding ${nested!.id} is not owned by r0:0 at owner depth`,
    );
  });

  it('includes deep nodes touched by an owner finding without importing nested findings', () => {
    const rows = Array.from({ length: 4 }, (_, index) => node(
      'article',
      rect(0, index * 40, 240, 32),
      [node('span', rect(index === 3 ? 12 : 8, index * 40 + 8, 80, 16), [text(`Row ${index}`)], {
        role: null,
        name: null,
      })],
      { role: 'article', name: `Row ${index}` },
    ));
    const report = analyzePresentation(capture(node(
      'main',
      rect(0, 0, 240, 152),
      rows,
      { role: 'main', name: 'Rows' },
    )));
    const finding = report.findings?.find((candidate) => candidate.rule === 'ALIGNMENT_OUTLIER');
    const ownerReading = focusPresentation(report, 'r0:0');

    expect(finding?.nodes).toEqual(['r0:0/3/0']);
    expect(ownerReading.nodes.map((candidate) => candidate.id)).toContain('r0:0/3/0');
    expect(ownerReading.findings).toContain(finding);
  });
});

function composition(): RawNode {
  const paragraphs = [
    node('p', rect(0, 0, 360, 20), [text('Required context.')], { role: null, name: null }),
    node('p', rect(0, 32, 360, 20), [text('More required context.')], { role: null, name: null }),
    node('p', rect(0, 64, 220, 48), [text('A deliberately distinct callout.')], { role: null, name: null }),
  ];
  const rows = Array.from({ length: 5 }, (_, index) => {
    const y = 44 + index * 40;
    return node(
      'li',
      rect(460, y, 400, 40),
      [
        node('p', rect(472, y + 6, 80, 16), [text(`0${index + 1}`)], { role: null, name: null }),
        node('p', rect(560, y + 26, 280, 16), [text(`Step ${index + 1}`)], { role: null, name: null }),
      ],
      { role: 'listitem', name: `Step ${index + 1}` },
    );
  });
  return node(
    'main',
    rect(0, 0, 900, 320),
    [
      node('div', rect(0, 0, 400, 160), paragraphs, { role: null, name: null }),
      node(
        'div',
        rect(450, 0, 450, 280),
        [
          node('div', rect(450, 0, 450, 40), [text('Illustration header')], { role: null, name: null }),
          node('ol', rect(460, 44, 400, 200), rows, { role: 'list', name: 'Workflow' }),
          node('div', rect(450, 248, 450, 32), [text('Illustration footer')], { role: null, name: null }),
        ],
        { role: null, name: null },
      ),
    ],
    { role: 'main', name: 'Agent review' },
  );
}

function capture(root: RawNode): RawCapture {
  return {
    captureVersion: 1,
    subject: { id: 'fixture:focus', kind: 'fixture' },
    profile: CHROMIUM_PROFILE,
    environment: {
      profile: 'chromium',
      engine: 'chromium@test',
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
  box: Rect,
  children: readonly RawNode[],
  aria: RawNode['aria'],
): RawNode {
  return {
    tag,
    attributes: {},
    aria,
    matchedRules: [],
    computedStyle: {
      'font-family': 'Arial',
      'font-size': '14px',
      'font-weight': '400',
      'font-style': 'normal',
      'line-height': '16px',
      color: 'rgb(20, 20, 20)',
    },
    rect: box,
    children,
  };
}

function text(value: string): RawNode {
  return { tag: '#text', attributes: {}, matchedRules: [], text: value, children: [] };
}

function rect(x: number, y: number, width: number, height: number): Rect {
  return { x, y, width, height };
}
