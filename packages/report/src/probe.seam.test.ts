import { describe, expect, it } from 'vitest';
import { clusterChanges, describeClustering } from './cluster.js';
import { changelogOf, isRecorded } from './changelog.js';
import type { ObservationRecord, RunReport } from './format.js';

const valueSubject: ObservationRecord = {
  subject: 'api/orders.json',
  verdict: 'changed',
  because: 'two paths changed type',
  changedPixels: 0,
  regions: [],
};
const domSubject: ObservationRecord = {
  subject: 'Button--primary',
  verdict: 'changed',
  because: '120 pixels differ',
  changedPixels: 120,
  regions: [
    { x: 0, y: 0, width: 10, height: 10, pixels: 120, cause: true, component: 'Button', fingerprint: 'shape-abc' },
  ],
};

describe('probe', () => {
  it('clusters', () => {
    const clustering = clusterChanges([valueSubject, domSubject]);
    console.log('clustering =', JSON.stringify(clustering, null, 2));
    console.log('describe =', describeClustering(clustering, 2));
  });

  it('changelog', () => {
    const report = {
      runVersion: 1,
      at: '2026-08-21T00:00:00Z',
      identity: { engine: 'x', engineVersion: '1', platform: 'p', deviceScaleFactor: 1 },
      retention: 'durable',
      run: { id: 'r1', commit: 'c1' },
      observations: [valueSubject, domSubject],
    } as unknown as RunReport;

    const a = changelogOf({ report, accepted: ['api/orders.json', 'Button--primary'], selection: 'all', at: 'T' });
    console.log('no entries =', JSON.stringify(a, null, 2));

    const b = changelogOf({
      report,
      accepted: ['api/orders.json', 'Button--primary'],
      selection: 'all',
      at: 'T',
      entries: [{ fingerprint: 'value/v1:deadbeef', subjects: ['api/orders.json'], reached: 1, cause: true, component: 'orders' }],
    });
    console.log('with entries =', JSON.stringify(b, null, 2));
    expect(isRecorded(b)).toBe(true);
  });
});
