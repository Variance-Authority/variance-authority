import { describe, expect, it } from 'vitest';
import type { ObservationRecord } from '@variance-authority/report';
import { renderComment } from './comment.js';
import type { CliRunReport } from './run.js';

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
  it('shows the leading cause before and after above the fold, at the published path', () => {
    const body = renderComment({ report: REPORT, imageRoot: ROOT });
    const before =
      '<img src="https://github.com/o/r/raw/0123abc/images/story%253Atoggle.before.png"';

    // The file on disk is `story%3Atoggle.before.png`; a URL carrying `%3A` raw
    // would be decoded by the server into a name nobody wrote.
    expect(body).toContain(before);
    expect(body.indexOf(before)).toBeLessThan(body.indexOf('<details>'));
  });

  it('gives each further cause its pair in the fold, and does not repeat the first', () => {
    const body = renderComment({ report: REPORT, imageRoot: ROOT });
    const fold = body.slice(body.indexOf('<details>'));

    expect(fold).toContain('alt="story:&quot;quoted&quot; after"');
    expect(fold).not.toContain('story%253Atoggle');
  });

  it('carries no picture when nothing was published', () => {
    expect(renderComment({ report: REPORT })).not.toContain('<img');
  });
});
