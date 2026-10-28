import { describe, expect, it } from 'vitest';
import type { ObservationRecord } from '@variance-authority/report';
import { renderComment } from './comment.js';
import type { CliRunReport } from './run.js';

const PROJECT = 'storybook-case';

function changed(subject: string, component: string, file: string): ObservationRecord {
  const name = encodeURIComponent(subject);
  return {
    subject,
    verdict: 'changed',
    because: '86 pixel(s) differ across 1 region(s)',
    changedPixels: 86,
    regions: [{ x: 4, y: 4, width: 16, height: 16, pixels: 86, component, file, cause: true }],
    images: {
      before: `images/${name}.before.png`,
      after: `images/${name}.after.png`,
      diff: `images/${name}.diff.png`,
      change: `images/${name}.change.png`,
    },
  };
}

const REPORT: CliRunReport = {
  runVersion: 1,
  at: '2026-09-25T10:00:00.000Z',
  identity: {
    renderer: 'playwright-chromium',
    engine: 'chromium@151',
    platform: 'linux/x64',
    deviceScaleFactor: 1,
    fonts: [],
  },
  retention: 'durable',
  observations: [
    changed('story:toggle', 'Toggle', 'src/ds/toggle.tsx:7'),
    changed('story:"quoted"', 'Badge', 'src/ds/badge.tsx:3'),
  ],
  notObserved: [],
};

const ROOT = 'https://github.com/o/r/raw/0123abc/';

describe('pictures in the comment, when the operator published the images', () => {
  it('shows the leading cause as its change, cropped, above the fold, at the published path', () => {
    const body = renderComment({ project: PROJECT, report: REPORT, imageRoot: ROOT });
    const change =
      '<img src="https://github.com/o/r/raw/0123abc/images/story%253Atoggle.change.png"';

    // The file on disk is `story%3Atoggle.change.png`; a URL carrying `%3A` raw
    // would be decoded by the server into a name nobody wrote.
    expect(body).toContain(change);
    expect(body.indexOf(change)).toBeLessThan(body.indexOf('<details>'));
  });

  it('shows one picture per subject at its own size, never the two whole pages', () => {
    const body = renderComment({ project: PROJECT, report: REPORT, imageRoot: ROOT });

    expect(body.match(/<img /g)).toHaveLength(2);
    expect(body).not.toContain('.before.png');
    expect(body).not.toContain('.after.png');
    expect(body).not.toContain('width=');
  });

  it('costs the comment no more text than the pair it replaces', () => {
    const pair: CliRunReport = {
      ...REPORT,
      observations: REPORT.observations.map((entry) => {
        const { change: _change, ...images } = entry.images!;
        return { ...entry, images };
      }),
    };

    const cropped = renderComment({ project: PROJECT, report: REPORT, imageRoot: ROOT });
    const whole = renderComment({ project: PROJECT, report: pair, imageRoot: ROOT });

    expect(cropped.length).toBeLessThan(whole.length);
  });

  it('gives each further cause its picture in the fold, and does not repeat the first', () => {
    const body = renderComment({ project: PROJECT, report: REPORT, imageRoot: ROOT });
    const fold = body.slice(body.indexOf('<details>'));

    expect(fold).toContain('alt="story:&quot;quoted&quot;: before beside after, the change marked"');
    expect(fold).not.toContain('story%253Atoggle');
  });

  it('falls back to the whole before and after when the change was not cropped', () => {
    const pair: CliRunReport = {
      ...REPORT,
      observations: REPORT.observations.map((entry) => {
        const { change: _change, ...images } = entry.images!;
        return { ...entry, images };
      }),
    };

    const body = renderComment({ project: PROJECT, report: pair, imageRoot: ROOT });

    expect(body).toContain('images/story%253Atoggle.before.png');
    expect(body).toContain('alt="story:&quot;quoted&quot; after"');
  });

  it('carries no picture when nothing was published', () => {
    expect(renderComment({ project: PROJECT, report: REPORT })).not.toContain('<img');
  });
});
