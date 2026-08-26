import { describe, expect, it } from 'vitest';
import { CHROMIUM_PROFILE, type RawCapture, type RawNode, type Rect } from '@variance-authority/core';
import { analyzePresentation, inspectPresentationAlignment } from './index.js';

describe('presentation alignment reading', () => {
  it('compares a visual flow across nested boxes without declaring every descendant a peer', () => {
    const report = analyzePresentation(capture(navigation(36, 34)));
    const reading = inspectPresentationAlignment(
      report,
      'r0:0',
      ['r0:0/0/0', 'r0:0/1/0', 'r0:0/1/1', 'r0:0/1/2'],
      'vertical-center',
    );

    expect(reading.coordinatePx).toBe(34);
    expect(reading.spreadPx).toBe(2);
    expect(reading.members).toEqual(expect.arrayContaining([
      expect.objectContaining({
        node: expect.objectContaining({ id: 'r0:0/0/0', name: 'Brand' }),
        coordinatePx: 36,
        deviationPx: 2,
      }),
    ]));
    expect(report.findings).toEqual([]);
  });

  it('reports a zero-spread aligned navigation flow', () => {
    const report = analyzePresentation(capture(navigation(36, 36)));
    const reading = inspectPresentationAlignment(
      report,
      'r0:0',
      ['r0:0/0/0', 'r0:0/1/0', 'r0:0/1/1', 'r0:0/1/2'],
      'vertical-center',
    );

    expect(reading.spreadPx).toBe(0);
    expect(reading.members.every((member) => member.deviationPx === 0)).toBe(true);
  });

  it('refuses to pull a member across the selected ownership boundary', () => {
    const report = analyzePresentation(capture(navigation(36, 36)));

    expect(() => inspectPresentationAlignment(
      report,
      'r0:0/1',
      ['r0:0/0/0', 'r0:0/1/0'],
      'vertical-center',
    )).toThrow('presentation alignment member r0:0/0/0 is not inside owner r0:0/1');
  });
});

function navigation(brandCenter: number, controlCenter: number): RawNode {
  const brandHeight = 30;
  const controlHeight = 40;
  return node('nav', rect(0, 0, 900, 72), [
    node('div', rect(0, 16, 180, 40), [
      node('a', rect(16, brandCenter - brandHeight / 2, 120, brandHeight), [text('Brand')], {
        role: 'link',
        name: 'Brand',
      }),
    ], { role: null, name: null }),
    node('div', rect(180, 16, 520, 40), Array.from({ length: 3 }, (_, index) =>
      node('a', rect(200 + index * 120, controlCenter - controlHeight / 2, 100, controlHeight), [text(`Item ${index + 1}`)], {
        role: 'link',
        name: `Item ${index + 1}`,
      })), { role: null, name: null }),
  ], { role: 'navigation', name: 'Primary' });
}

function capture(root: RawNode): RawCapture {
  return {
    captureVersion: 1,
    subject: { id: 'fixture:navigation', kind: 'fixture' },
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

function node(tag: string, box: Rect, children: readonly RawNode[], aria: RawNode['aria']): RawNode {
  return {
    tag,
    attributes: {},
    aria,
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
