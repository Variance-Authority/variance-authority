import { describe, expect, it } from 'vitest';
import { CHROMIUM_PROFILE, type RawCapture, type RawNode, type Rect } from '@variance-authority/core';
import {
  analyzePresentation,
  inspectPresentationHierarchy,
  type PresentationHierarchyContract,
} from './index.js';

describe('product-owned presentation hierarchy', () => {
  it('exposes a collision between declared leading-to-body and body-peer roles', () => {
    const report = analyzePresentation(capture(structure({ leading: 4, peer: 4 })));
    const reading = inspectPresentationHierarchy(report, contract());

    expect(reading.levels.map((level) => [level.role, level.distanceMedianPx])).toEqual([
      ['owner-boundary', 12],
      ['leading-to-body', 4],
      ['body-peer', 4],
      ['content-internal', 2],
    ]);
    expect(reading.collisions).toEqual([{
      outer: 'leading-to-body',
      inner: 'body-peer',
      outerMedianPx: 4,
      innerMedianPx: 4,
      ratio: 1,
      sharedSpacingClusters: expect.any(Array),
    }]);
    expect(reading.findings).toEqual([
      expect.objectContaining({
        id: 'H1',
        rule: 'SPACING_HIERARCHY_COLLISION',
        owner: 'r0:0',
        contract: 'record-hierarchy',
        measurements: expect.objectContaining({
          outerRole: 'leading-to-body',
          innerRole: 'body-peer',
          ratio: 1,
        }),
      }),
    ]);
    expect(reading.paint).toHaveLength(4);
    expect(reading.paint.filter((instruction) => instruction.color === '#ff1744')).toHaveLength(2);
  });

  it('does not invent a collision when every declared relationship is distinguishable', () => {
    const report = analyzePresentation(capture(structure({ leading: 8, peer: 4 })));
    const reading = inspectPresentationHierarchy(report, contract());

    expect(reading.collisions).toEqual([]);
    expect(reading.findings).toEqual([]);
  });

  it('refuses contracts that erase ownership or relationship order', () => {
    const report = analyzePresentation(capture(structure({ leading: 4, peer: 4 })));
    const reversed: PresentationHierarchyContract = {
      ...contract(),
      levels: [...contract().levels].reverse(),
    };
    const outside: PresentationHierarchyContract = {
      ...contract(),
      owner: 'r0:0/1',
    };

    expect(() => inspectPresentationHierarchy(report, reversed)).toThrow('must be ordered outside-in');
    expect(() => inspectPresentationHierarchy(report, outside)).toThrow('is outside owner r0:0/1');
  });
});

function contract(): PresentationHierarchyContract {
  return {
    id: 'record-hierarchy',
    owner: 'r0:0',
    axis: 'vertical',
    levels: [
      { role: 'owner-boundary', relations: [{ from: 'r0:0/0', to: 'r0:0/1' }] },
      { role: 'leading-to-body', relations: [{ from: 'r0:0/1/0', to: 'r0:0/1/1' }] },
      { role: 'body-peer', relations: [{ from: 'r0:0/1/1', to: 'r0:0/1/2' }] },
      { role: 'content-internal', relations: [{ from: 'r0:0/1/1/0', to: 'r0:0/1/1/1' }] },
    ],
  };
}

function structure(options: { readonly leading: number; readonly peer: number }): RawNode {
  const field = (y: number, value: string) => node('div', rect(0, y, 320, 38), [
    node('span', rect(0, y, 320, 16), [text('Does')]),
    node('span', rect(0, y + 18, 320, 20), [text(value)]),
  ]);
  const currentTop = 72;
  const firstFieldTop = currentTop + 16 + options.leading;
  return node('main', rect(0, 0, 320, 240), [
    node('article', rect(0, 0, 320, 60), [node('p', rect(0, 0, 320, 60), [text('Previous')])]),
    node('article', rect(0, currentTop, 320, 140), [
      node('span', rect(0, currentTop, 320, 16), [text('Document')], { 'font-weight': '600' }),
      field(firstFieldTop, 'Cooling-off period'),
      field(firstFieldTop + 38 + options.peer, 'Terminate'),
    ]),
  ]);
}

function capture(root: RawNode): RawCapture {
  return {
    captureVersion: 1,
    subject: { id: 'fixture:hierarchy', kind: 'fixture' },
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
  style: Readonly<Record<string, string>> = {},
): RawNode {
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
      'line-height': '20px',
      color: 'rgb(20, 20, 20)',
      ...style,
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
