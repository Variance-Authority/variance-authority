import { describe, expect, it } from 'vitest';
import { CHROMIUM_PROFILE, type RawCapture, type RawNode, type Rect } from '@variance-authority/core';
import { analyzePresentation, inspectPresentationSpacing } from './index.js';

describe('presentation spacing reading', () => {
  it('keeps heterogeneous composition sections together at their shared owner', () => {
    const report = analyzePresentation(capture(pageSections()));
    const reading = inspectPresentationSpacing(
      report,
      'r0:0',
      ['r0:0/0', 'r0:0/1', 'r0:0/2', 'r0:0/3'],
      'vertical',
    );

    expect(reading.distance).toEqual({ minPx: 0, medianPx: 0, maxPx: 38 });
    expect(reading.boundary.min).toBeLessThan(reading.boundary.max);
    expect(reading.separations.map((separation) => separation.distancePx)).toEqual([0, 0, 38]);
    expect(reading.paint).toHaveLength(3);
    expect(reading.paint[0]).toEqual(expect.objectContaining({
      owner: 'r0:0',
      nodes: ['r0:0/0', 'r0:0/1'],
      layer: 'spacing',
      label: expect.stringContaining('0px'),
    }));
    expect(report.findings).toEqual([]);
  });

  it('refuses to flatten descendants or skip a structural sibling', () => {
    const report = analyzePresentation(capture(pageSections()));

    expect(() => inspectPresentationSpacing(
      report,
      'r0:0',
      ['r0:0/0/0', 'r0:0/1'],
      'vertical',
    )).toThrow('is not an immediate child');
    expect(() => inspectPresentationSpacing(
      report,
      'r0:0',
      ['r0:0/0', 'r0:0/2'],
      'vertical',
    )).toThrow('must be consecutive');
  });

  it('retains a touching boundary rounded to overlap in an ordered vertical composition', () => {
    const root = pageSections();
    const second = root.children[1]!;
    const overlapping = {
      ...second,
      rect: rect(0, 99.99, 960, 80),
    };
    const report = analyzePresentation(capture({
      ...root,
      children: [root.children[0]!, overlapping, ...root.children.slice(2)],
    }));

    const reading = inspectPresentationSpacing(
      report,
      'r0:0',
      ['r0:0/0', 'r0:0/1'],
      'vertical',
    );

    expect(reading.separations[0]).toEqual(expect.objectContaining({ distancePx: 0 }));
  });
});

function pageSections(): RawNode {
  return node('main', rect(0, 0, 960, 500), [
    node('section', rect(0, 0, 960, 100), [node('h1', rect(24, 24, 400, 32), [text('Matter')])]),
    node('aside', rect(0, 100, 960, 80), [node('p', rect(24, 124, 400, 24), [text('Summary')])]),
    node('div', rect(0, 180, 960, 120), [node('button', rect(24, 204, 120, 32), [text('Review')])]),
    node('section', rect(0, 338, 960, 120), [node('h2', rect(24, 362, 400, 28), [text('Activity')])]),
  ]);
}

function capture(root: RawNode): RawCapture {
  return {
    captureVersion: 1,
    subject: { id: 'fixture:sections', kind: 'fixture' },
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

function node(tag: string, box: Rect, children: readonly RawNode[]): RawNode {
  return {
    tag,
    attributes: {},
    aria: { role: null, name: null },
    matchedRules: [],
    computedStyle: {
      'font-family': 'Arial',
      'font-size': '16px',
      'font-weight': '400',
      'font-style': 'normal',
      'line-height': '24px',
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
