import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core';
import { OperatorError } from '../exit.js';
import { formatReport } from './report.js';
import { reportHtml } from './report-html.js';
import type { CliRunReport } from './run.js';

/**
 * The page is a third rendering of one docket, and these tests are about the
 * three ways a third rendering goes wrong: saying something the other two do
 * not, looking complete when it is not, and reaching the network.
 *
 * They deliberately assert *markers* rather than sentences. The page is opened
 * most days by the same person, so a qualification that reads as a clause the
 * first time is friction every time after — but the qualification itself may
 * never be dropped, and each one below has a test that it survived the
 * compression.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/sha256-abc'],
};

function reportOf(over: Partial<CliRunReport> = {}): CliRunReport {
  return {
    runVersion: 1,
    at: '2026-08-05T09:00:00.000Z',
    identity: IDENTITY,
    retention: 'durable',
    observations: [],
    notObserved: [],
    ...over,
  };
}

const CHANGED = {
  subject: 'story:toggle',
  verdict: 'changed' as const,
  because: '86 pixel(s) differ across 1 region(s) in Toggle',
  changedPixels: 86,
  regions: [
    {
      x: 4,
      y: 4,
      width: 16,
      height: 16,
      pixels: 86,
      component: 'Toggle',
      where: 'main → list item 2 of 3',
      file: 'src/ds/components.tsx:107',
      cause: true,
      fingerprint: 'v1:2c4f9a1e0b7d3856a91c4e2f8b06d735',
    },
  ],
  images: {
    before: 'images/toggle.before.png',
    after: 'images/toggle.after.png',
    diff: 'images/toggle.diff.png',
  },
};

const PRESENTATION = {
  verdict: 'changed' as const,
  before: 'sha256:before' as never,
  after: 'sha256:after' as never,
  information: {
    contentPreserved: true,
    characters: { before: 80, after: 80, delta: 0 },
    elements: { before: 12, after: 12, delta: 0 },
    repeatedObjects: { before: 3, after: 3, delta: 0 },
  },
  effects: [{
    rule: 'SPACING_HIERARCHY_COLLISION',
    transition: 'introduced' as const,
    owner: 'r0:0/4/1',
    nodes: ['r0:0/4/1/0', 'r0:0/4/1/1'],
    contract: 'underwriter-demand-record',
    after: { finding: 'H1', measurements: { outerMedianPx: 4, innerMedianPx: 3.99 } },
  }],
};

describe('the page leads with the cause', () => {
  it('heads itself with the component, never with a pixel count', () => {
    const html = reportHtml(reportOf({ observations: [CHANGED] }));

    expect(html).toContain('<h1>Toggle');
    expect(html).not.toContain('<h1>86');
    expect(html).toContain('<title>1 to review · Toggle — variance</title>');
  });

  it('marks an entry the semantic tier did not name', () => {
    // `namedIn: 0` means the entry is the largest region by area, which
    // `rankRegions` documents as getting the ordering wrong. A page that printed
    // it in the same voice as a named cause would be the confident wrong
    // attribution this project refuses elsewhere. It is a marker rather than a
    // sentence — and the sentence is still reachable, on the `title`.
    const html = reportHtml(
      reportOf({
        observations: [{ ...CHANGED, regions: [{ ...CHANGED.regions[0]!, cause: false }] }],
      }),
    );

    expect(html).toContain('>by area<');
    expect(html).toContain('Ranked by area');
  });

  it('puts the diff between the two images it is a diff of', () => {
    // Three pictures in the order the record happens to list them makes the
    // reader's eye travel past both things they are comparing to reach the
    // reason the page is open.
    const html = reportHtml(reportOf({ observations: [CHANGED] }));

    const before = html.indexOf('images/toggle.before.png');
    const diff = html.indexOf('images/toggle.diff.png');
    const after = html.indexOf('images/toggle.after.png');

    expect(before).toBeGreaterThan(-1);
    expect(diff).toBeGreaterThan(before);
    expect(after).toBeGreaterThan(diff);
  });

  it('offers the comparisons an arrangement of pictures cannot make', () => {
    // A wipe, a blend and an overlay are what turn three images into a
    // comparison; a 4-pixel shift is invisible in any of them side by side.
    const html = reportHtml(reportOf({ observations: [CHANGED] }));

    for (const mode of ['regions', 'wipe', 'blend', 'blink', 'trio']) {
      expect(html).toContain(`data-mode="${mode}"`);
    }
  });

  it('carries the boxes the overlay draws, since no raster size is recorded', () => {
    const html = reportHtml(reportOf({ observations: [CHANGED] }));

    expect(html).toContain('data-box="4,4,16,16"');
  });

  it('makes the fingerprint and the command it belongs to take-away-able', () => {
    const html = reportHtml(reportOf({ observations: [CHANGED] }));

    expect(html).toContain('v1:2c4f9a1e0b7d3856a91c4e2f8b06d735');
    expect(html).toContain('variance accept --shape v1:2c4f9a1e0b7d3856a91c4e2f8b06d735');
    expect(html).toContain('variance again story:toggle');
  });

  it('carries the renderer identity, because a page is read on another machine', () => {
    const html = reportHtml(reportOf({ observations: [CHANGED], intent: 'restyle the toggle' }));

    expect(html).toContain('chromium@131');
    expect(html).toContain('restyle the toggle');
  });
});

describe('the page retains presentation impact without rewriting the verdict', () => {
  it('shows a presentation-only consequence on an unchanged subject', () => {
    const html = reportHtml(reportOf({
      observations: [{
        subject: 'story:underwriter',
        verdict: 'unchanged',
        because: 'no pixels differ',
        changedPixels: 0,
        signals: { presentation: PRESENTATION },
        regions: [],
      }],
    }));

    expect(html).toContain('Presentation impact');
    expect(html).toContain('underwriter-demand-record');
    expect(html).toContain('innerMedianPx=3.99');
    expect(html).toContain('<h1 class="ok">clean</h1>');
  });
});

describe('the page cannot look complete when it is not', () => {
  it('counts a subject the run could not observe into the run’s whole plan', () => {
    // The refusal is arithmetic rather than prose: the bar is every subject the
    // run planned, so a failure is visibly part of the same bar as the passes
    // and cannot be read past.
    const html = reportHtml(
      reportOf({
        observations: [CHANGED],
        notObserved: [{ subject: 'story:card', kind: 'failed', because: 'the browser crashed' }],
      }),
    );

    expect(html).toContain('data-status="incomplete"');
    expect(html).toContain('class="seg failed"');
    expect(html).toContain('story:card');
    expect(html).toContain('the browser crashed');
  });

  it('says so at the head when nothing was observed at all', () => {
    const html = reportHtml(
      reportOf({
        notObserved: [{ subject: 'story:card', kind: 'failed', because: 'the browser crashed' }],
      }),
    );

    expect(html).toContain('<h1 class="bad">incomplete</h1>');
    expect(html).not.toContain('clean');
  });

  it('refuses --subject rather than rendering a narrowed page', () => {
    // A page narrowed to one subject says nothing about coverage while looking
    // like a whole run, and its reader has no prompt to retype the command in.
    expect(() =>
      formatReport({
        report: reportOf({ observations: [CHANGED] }),
        format: 'html',
        subject: 'story:toggle',
      }),
    ).toThrow(OperatorError);
  });
});

describe('the page is self-contained', () => {
  it('fetches nothing, of any kind', () => {
    // A page that loads a stylesheet, a font or an image host renders
    // differently in the reviewer's browser than it did in CI — a peculiar
    // thing for this project of all projects to ship. The script is inline and
    // decides nothing about the run; every number is in the artifact before it
    // runs.
    const html = reportHtml(reportOf({ observations: [CHANGED] }));

    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('<link');
    expect(html).not.toMatch(/\bfetch\(/);
    expect(html).not.toMatch(/XMLHttpRequest|importScripts|EventSource/);
    expect(html).toContain('<script>');
    expect(html.match(/<script/g)).toHaveLength(1);
  });

  it('escapes everything that came out of somebody else’s page', () => {
    const html = reportHtml(
      reportOf({
        observations: [
          {
            ...CHANGED,
            subject: 'story:<img src=x onerror=alert(1)>',
            regions: [{ ...CHANGED.regions[0]!, component: '"><script>alert(1)</script>' }],
          },
        ],
      }),
    );

    // The payload survives as *text* — that is what escaping means — so the
    // assertion is that no tag was produced, not that the characters are gone.
    // It matters more now than it did: the page carries a script, so an
    // unescaped attribute is an execution context rather than a broken layout.
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
