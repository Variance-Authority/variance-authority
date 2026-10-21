import type { RenderIdentity } from '@variance-authority/core/format';
import { reportHtml as pieces } from './report-html.js';
import type { CliRunReport } from './run.js';

/** The page as the reader gets it, its pieces joined. */
export const reportHtml = (report: CliRunReport): string => [...pieces(report)].join('');

export const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/sha256-abc'],
};

export function reportOf(over: Partial<CliRunReport> = {}): CliRunReport {
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

export const CHANGED = {
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
