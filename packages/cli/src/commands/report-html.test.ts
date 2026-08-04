import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core';
import { OperatorError } from '../exit.js';
import { formatReport } from './report.js';
import { reportHtml } from './report-html.js';
import type { CliRunReport } from './run.js';

/**
 * The page is a third rendering of one docket, and these tests are about the two
 * ways a third rendering goes wrong: saying something the other two do not, and
 * looking complete when it is not.
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
    },
  ],
  images: { before: 'images/toggle.before.png', after: 'images/toggle.after.png', diff: 'images/toggle.diff.png' },
};

describe('the page leads with the cause', () => {
  it('titles itself with the component, never with a pixel count', () => {
    const html = reportHtml(reportOf({ observations: [CHANGED] }));

    expect(html).toContain('<h1>Toggle changed in 1 subject</h1>');
    expect(html).not.toContain('<h1>86');
  });

  it('marks an entry the semantic tier did not name', () => {
    // `namedIn: 0` means the entry is the largest region by area, which
    // `rankRegions` documents as getting the ordering wrong. A page that printed
    // it in the same voice as a named cause would be the confident wrong
    // attribution this project refuses elsewhere.
    const html = reportHtml(
      reportOf({
        observations: [
          { ...CHANGED, regions: [{ ...CHANGED.regions[0]!, cause: false }] },
        ],
      }),
    );

    expect(html).toContain('largest region, not a named cause');
  });

  it('shows the three images at the paths the record declares', () => {
    const html = reportHtml(reportOf({ observations: [CHANGED] }));

    for (const source of ['images/toggle.before.png', 'images/toggle.after.png', 'images/toggle.diff.png']) {
      expect(html).toContain(`src="${source}"`);
    }
  });

  it('carries the renderer identity, because a page is read on another machine', () => {
    const html = reportHtml(reportOf({ observations: [CHANGED], intent: 'restyle the toggle' }));

    expect(html).toContain('chromium@131');
    expect(html).toContain('restyle the toggle');
  });
});

describe('the page cannot look complete when it is not', () => {
  it('states a subject the run could not observe, before any finding', () => {
    const html = reportHtml(
      reportOf({
        observations: [CHANGED],
        notObserved: [{ subject: 'story:card', kind: 'failed', because: 'the browser crashed' }],
      }),
    );

    expect(html).toContain('This is not a pass.');
    expect(html).toContain('story:card');
  });

  it('says so in the headline when nothing was observed at all', () => {
    const html = reportHtml(
      reportOf({
        notObserved: [{ subject: 'story:card', kind: 'failed', because: 'the browser crashed' }],
      }),
    );

    expect(html).toContain('<h1>1 subject(s) could not be observed</h1>');
  });

  it('refuses --subject rather than rendering a narrowed page', () => {
    // A page narrowed to one subject says nothing about coverage while looking
    // like a whole run, and its reader has no prompt to retype the command in.
    expect(() =>
      formatReport({ report: reportOf({ observations: [CHANGED] }), format: 'html', subject: 'story:toggle' }),
    ).toThrow(OperatorError);
  });
});

describe('the page is self-contained and inert', () => {
  it('fetches nothing and runs nothing', () => {
    // A page that loads a stylesheet, a font or a script renders differently in
    // the reviewer's browser than it did in CI — a peculiar thing for this
    // project of all projects to ship.
    const html = reportHtml(reportOf({ observations: [CHANGED] }));

    expect(html).not.toContain('<script');
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain('<link');
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
    expect(html).not.toContain('<script>alert(1)');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;');
  });
});
