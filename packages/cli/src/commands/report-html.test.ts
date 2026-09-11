import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
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

describe('every segment of the census bar leads somewhere', () => {
  /**
   * The bar draws the run's whole plan and every segment on it is a button. Four
   * of them used to empty the page: two green verdicts the pane is not built
   * from, and two kinds of record that are not observations and have no verdict
   * to be filtered by. A reader who presses *excluded* and is shown nothing has
   * been answered "none", which is the one thing a coverage bar must never say.
   */
  const CENSUS = reportOf({
    observations: [
      CHANGED,
      {
        subject: 'story:footer',
        verdict: 'unchanged' as const,
        because: 'the rendered image matches the baseline',
        changedPixels: 0,
        regions: [],
      },
      {
        subject: 'story:clock',
        verdict: 'ignored' as const,
        because: 'every differing pixel fell inside an excluded subtree',
        changedPixels: 0,
        regions: [],
        ignored: { pixels: 940, boxes: 1, inert: 0, byRule: { clock: 940 } },
      },
    ],
    notObserved: [
      { subject: 'story:legacy', kind: 'excluded' as const, because: 'excluded by config' },
      { subject: 'route/checkout', kind: 'failed' as const, because: 'the browser crashed' },
    ],
  });

  it('gives every verdict the bar counts something on the page carrying it', () => {
    const html = reportHtml(CENSUS);
    const filters = [...html.matchAll(/data-filter="([^"]+)"/g)].map((match) => match[1]);
    const carried = new Set(
      [...html.matchAll(/data-verdict="([^"]+)"/g)].map((match) => match[1]),
    );

    expect(filters).toHaveLength(5);
    for (const name of filters) expect(carried).toContain(name);
  });

  it('names the excluded subjects rather than only counting them', () => {
    // The count is on the bar and the names are nowhere else in the report: a
    // reviewer asking which subjects nobody looked at has one place to ask.
    expect(reportHtml(CENSUS)).toContain('story:legacy');
    expect(reportHtml(CENSUS)).toContain('excluded by config');
  });

  it('says which rule made a subject green by declaration', () => {
    // `ignored` is green that somebody wrote down, and a page that renders it as
    // green earned by a comparison has hidden the mask rather than reported it.
    expect(reportHtml(CENSUS)).toContain('absorbed by <code>clock</code>');
  });

  it('says a green subject was absorbed by something it cannot name', () => {
    // Absent is not empty. A verdict of `ignored` with no rule recorded is a
    // report written by something that did not keep them, and both an empty
    // cell and a zero would be a claim about a rule.
    const html = reportHtml(
      reportOf({
        observations: [
          {
            subject: 'story:clock',
            verdict: 'ignored' as const,
            because: 'absorbed',
            changedPixels: 0,
            regions: [],
          },
        ],
      }),
    );

    expect(html).toContain('did not record which rule');
  });

  it('folds the settled rows away rather than opening on three hundred of them', () => {
    // On the page, and not in the way of it. The green half is a destination the
    // census bar leads to, not the first thing a reviewer scrolls past.
    const html = reportHtml(CENSUS);

    expect(html).toContain('<section id="Settled" class="hidden"');
    expect(html).toContain('<div class="entry quiet hidden" data-subject="story:footer"');
    // A coverage hole is never folded away, whatever else is.
    expect(html).toContain('<section id="Not-observed"');
    expect(html).toContain('<div class="entry" data-subject="route/checkout"');
  });
});

describe('the declaration ledgers are read, not duck-typed', () => {
  /**
   * The audit surface that stops a mask growing over a real regression. Its one
   * failure mode is a table that decides for itself what *dead* means: `pixels
   * === 0` calls every rule in a fresh checkout dead, on the run that proves
   * least about any of them.
   */
  const LEDGERS = reportOf({
    observations: [],
    ignores: {
      rules: [
        {
          rule: 'clock',
          reason: 'the clock ticks',
          pixels: 0,
          subjects: 3,
          comparedIn: 0,
          inertIn: 0,
          unresolved: false,
          unwornTags: [],
          expired: false,
        },
        {
          rule: 'carousel',
          reason: 'it autoplays',
          pixels: 0,
          subjects: 2,
          comparedIn: 2,
          inertIn: 2,
          unresolved: false,
          unwornTags: [],
          expired: false,
        },
      ],
      dead: ['carousel'],
      fullyIgnored: [],
      totalPixels: 0,
      vocabulary: [],
    },
    sensitivities: {
      rules: [
        {
          rule: 'marketing',
          reason: 'copy moves weekly',
          level: 'layout',
          scoped: 0,
          absorbed: [],
          bands: [],
          unscoped: true,
        },
      ],
      totalAbsorbed: 0,
    },
  });

  it('keeps a rule nothing compared apart from a rule that caught nothing', () => {
    const html = reportHtml(LEDGERS);

    expect(html).toContain('<tr class="untested">');
    expect(html).toContain('<tr class="dead">');
  });

  it('marks only the rule somebody has to act on', () => {
    // `untested` is the absence of evidence. A report that flagged it would ask
    // an operator to act on a run that measured nothing, which is how an audit
    // stops being read.
    const untested = /<tr class="untested">.*?<\/tr>/s.exec(reportHtml(LEDGERS))?.[0] ?? '';
    const dead = /<tr class="dead">.*?<\/tr>/s.exec(reportHtml(LEDGERS))?.[0] ?? '';

    expect(untested).toContain('mark quiet');
    expect(dead).toContain('mark warn');
  });

  it('says no tag was checked rather than letting silence read as a pass', () => {
    expect(reportHtml(LEDGERS)).toContain('no subject in this run declared a tag');
  });

  it('carries the sensitivity level, which is the claim the absorption is evidence for', () => {
    const html = reportHtml(LEDGERS);

    expect(html).toContain('asserts on layout');
    expect(html).toContain('<tr class="unscoped">');
  });
});

describe('the defect list says what it is a list of, and whose the defect is', () => {
  const inspected = (findings: readonly Record<string, unknown>[]): string =>
    reportHtml(reportOf({ observations: [{ ...CHANGED, findings }] as never }));

  const nameless = {
    rule: 'control-without-name',
    band: 'a11y',
    what: 'a control has no accessible name',
    path: '0/1/0',
    component: 'Button',
  };

  it('heads the list with the band rather than shipping a run of rule slugs', () => {
    // The page used to emit a bare `<ul class="findings">` under no heading of any
    // kind, so a reader had to infer the subject of the report from the names of
    // its rules.
    expect(inspected([nameless])).toContain('Accessibility');
  });

  it('says the same sentences the review page says, from the same fold', () => {
    const page = inspected([{ ...nameless, standing: false }]);

    expect(page).toContain('arrived with this change');
    expect(page).toContain('1 defect read from this render, with no baseline compared');
  });

  it('never prints an undated defect as one this change introduced', () => {
    const page = inspected([nameless]);

    expect(page).toContain('none of them can be dated');
    expect(page).not.toContain('arrived with this change');
  });
});
