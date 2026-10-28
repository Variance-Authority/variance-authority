import { describe, expect, it } from 'vitest';
import type { ObservationRecord } from '@variance-authority/report';
import { bulkBlocks } from './comment-blocks.js';
import { DEFAULT_LIMITS } from './comment.js';
import type { CliRunReport } from './run.js';

const SHAPE = 'v1:brand-accent';

function changed(subject: string, fingerprint?: string): ObservationRecord {
  return {
    subject,
    verdict: 'changed',
    because: '40 pixel(s) differ across 1 region(s)',
    changedPixels: 40,
    regions: [
      {
        x: 0,
        y: 0,
        width: 8,
        height: 5,
        pixels: 40,
        cause: true,
        ...(fingerprint !== undefined ? { component: 'Button', fingerprint } : {}),
      },
    ],
  };
}

function reportOf(observations: readonly ObservationRecord[]): CliRunReport {
  return {
    runVersion: 1,
    at: '2026-08-01T10:00:00.000Z',
    identity: {
      renderer: 'playwright-chromium',
      engine: 'chromium@131',
      platform: 'linux/x64',
      deviceScaleFactor: 1,
      fonts: [],
    },
    retention: 'ephemeral',
    observations,
    notObserved: [],
  };
}

describe('bulkBlocks', () => {
  it('names what the run read, not its retention, for a subject no shape could group', () => {
    const body = bulkBlocks(
      reportOf([
        changed('story:primary', SHAPE),
        changed('story:secondary', SHAPE),
        changed('story:unread'),
      ]),
      DEFAULT_LIMITS,
    ).join('\n');

    // An ephemeral run whose collector gave a snapshot has shapes, and this one
    // grouped two subjects under one. The third has none because no region of it
    // was fingerprinted, which is about the markup the run read for it.
    expect(body).toContain('3 changed subject(s) are 1 distinct change(s)');
    expect(body).toContain(
      'No difference shape for 1 changed subject: the run read no markup there, or only the ' +
        'accessibility tree changed',
    );
    expect(body).not.toContain('without a document');
  });
});
