import { describe, expect, it } from 'vitest';
import { digestValue } from '@variance-authority/core';
import type { ObservationRecord, PresentationSignalRecord, RunReport } from '@variance-authority/report';
import { describePresentation, presentationSummary } from './presentation.js';

const SIGNAL: PresentationSignalRecord = {
  verdict: 'changed',
  before: digestValue('before'),
  after: digestValue('after'),
  information: {
    contentPreserved: true,
    characters: { before: 80, after: 80, delta: 0 },
    elements: { before: 12, after: 12, delta: 0 },
    repeatedObjects: { before: 3, after: 3, delta: 0 },
  },
  effects: [{
    rule: 'SPACING_HIERARCHY_COLLISION',
    transition: 'introduced',
    owner: 'r0:0/4/1',
    nodes: ['r0:0/4/1/0', 'r0:0/4/1/1'],
    contract: 'underwriter-demand-record',
    after: {
      finding: 'H1',
      measurements: { outerRole: 'leading-to-body', outerMedianPx: 4, innerMedianPx: 3.99 },
    },
  }],
};

describe('presentation evidence in agent report answers', () => {
  it('states the consequence and its evidence without changing the verdict', () => {
    const text = describePresentation(SIGNAL).join('\n');

    expect(text).toContain('[introduced] SPACING_HIERARCHY_COLLISION');
    expect(text).toContain('contract underwriter-demand-record');
    expect(text).toContain('innerMedianPx=3.99');
    expect(text).toContain('content preserved');
  });

  it('counts measured and incomparable subjects separately', () => {
    const report = reportOf([
      observation('underwriter', SIGNAL),
      observation('unknown', { verdict: 'incomparable', because: 'the baseline supplied no reading' }),
    ]);

    expect(presentationSummary(report)).toEqual([
      expect.stringContaining('1 introduced, 0 resolved, 0 persisted'),
    ]);
    expect(presentationSummary(report)[0]).toContain('1 compared, 1 incomparable');
    expect(presentationSummary(report)[0]).toContain('Independent of the regression verdict');
  });
});

function observation(subject: string, presentation: PresentationSignalRecord): ObservationRecord {
  return {
    subject,
    verdict: 'unchanged',
    because: 'no pixels differ',
    changedPixels: 0,
    signals: { presentation },
    regions: [],
  };
}

function reportOf(observations: readonly ObservationRecord[]): RunReport {
  return {
    runVersion: 1,
    at: '2026-08-26T00:00:00.000Z',
    identity: {
      renderer: 'fixture',
      engine: 'fixture@1',
      platform: 'fixture',
      deviceScaleFactor: 1,
      fonts: [],
    },
    retention: 'durable',
    observations,
  };
}
