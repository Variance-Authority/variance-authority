import { describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import { createAbsentStore, type Approval, type HistoryStore } from '@variance-authority/history';
import type { BaselineKey, RasterStore } from '@variance-authority/raster';
import { createEphemeralStore } from '@variance-authority/raster';
import type { ObservationRecord } from '@variance-authority/report';
import { accept, formatAcceptance } from './accept.js';
import type { CliRunReport } from './run.js';

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

const CANDIDATE: Raster = {
  documentDigest: 'sha256-candidate' as Raster['documentDigest'],
  identity: IDENTITY,
  width: 100,
  height: 40,
  bytes: Buffer.from('png').toString('base64'),
  missingFonts: [],
};

function observation(overrides: Partial<ObservationRecord>): ObservationRecord {
  return {
    subject: 'fixture:a',
    verdict: 'changed',
    because: '86 pixel(s) differ',
    changedPixels: 86,
    regions: [],
    images: { after: 'images/fixture%3Aa.after.png' },
    ...overrides,
  };
}

function reportOf(observations: readonly ObservationRecord[]): CliRunReport {
  return {
    runVersion: 1,
    at: '2026-08-01T00:00:00.000Z',
    identity: IDENTITY,
    retention: 'durable',
    observations,
    notObserved: [
      { subject: 'fixture:skipped', kind: 'failed', because: 'the story never became ready' },
    ],
  };
}

/** An ephemeral store that records what was promoted, since it keeps nothing itself. */
function recordingStore(): { store: RasterStore; puts: [BaselineKey, Raster][] } {
  const puts: [BaselineKey, Raster][] = [];
  return {
    puts,
    store: {
      ...createEphemeralStore(),
      retention: 'durable',
      async put(key, raster) {
        puts.push([key, raster]);
      },
    },
  };
}

describe('recording that somebody accepted', () => {
  function approvingStore(): { store: HistoryStore; approved: Approval[][] } {
    const approved: Approval[][] = [];
    return {
      approved,
      store: {
        ...createAbsentStore(),
        async approve(approvals) {
          approved.push([...approvals]);
        },
      },
    };
  }

  const RUN = { id: 'github-9-1', commit: 'abc123' };

  it('records one approval per subject it promoted, against the run that proposed it', async () => {
    // The row a run cannot write. Every observation a run records is unapproved —
    // acceptance happens later, by somebody who looked — so without this a
    // component that changed in every run of a quarter reports as never having
    // changed.
    const { store } = recordingStore();
    const { store: history, approved } = approvingStore();

    const result = await accept({
      report: { ...reportOf([observation({})]), run: RUN },
      reportDir: '/repo/out',
      store,
      subjects: ['fixture:a'],
      all: false,
      read: async () => CANDIDATE,
      history,
      project: 'shop',
      now: () => '2026-08-10T12:00:00.000Z',
    });

    expect(approved).toEqual([
      [{ project: 'shop', subject: 'fixture:a', run: 'github-9-1', at: '2026-08-10T12:00:00.000Z' }],
    ]);
    expect(result.approvals).toEqual({ recorded: 1 });
  });

  it('records nothing, and says so, for a report that cannot name its run', async () => {
    // An id invented here would attach somebody's approval to a build that never
    // happened, and no later query could tell the two apart.
    const { store } = recordingStore();
    const { store: history, approved } = approvingStore();

    const result = await accept({
      report: reportOf([observation({})]),
      reportDir: '/repo/out',
      store,
      subjects: ['fixture:a'],
      all: false,
      read: async () => CANDIDATE,
      history,
      project: 'shop',
    });

    expect(approved).toEqual([]);
    expect(result.accepted).toHaveLength(1);
    expect(result.approvals?.because).toContain('does not say which run produced it');
  });

  it('keeps a promoted baseline when the record refuses the acceptance', async () => {
    // The image is already on disk. Failing the command would leave a caller
    // retrying into a run where every subject is already the baseline, recording
    // nothing at all — so the failure is a sentence rather than an exception.
    const { store } = recordingStore();
    const history: HistoryStore = {
      ...createAbsentStore(),
      async approve() {
        throw new Error('connection refused');
      },
    };

    const result = await accept({
      report: { ...reportOf([observation({})]), run: RUN },
      reportDir: '/repo/out',
      store,
      subjects: ['fixture:a'],
      all: false,
      read: async () => CANDIDATE,
      history,
      project: 'shop',
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.approvals?.because).toContain('connection refused');
    expect(formatAcceptance(result)).toContain('history:');
  });

  it('approves only what it promoted, not what was already the baseline', async () => {
    // A subject that was already the baseline was approved by whoever made it
    // one. Re-approving it under this run's id would attach a decision to a build
    // that never proposed the change.
    const { store } = recordingStore();
    const { store: history, approved } = approvingStore();

    await accept({
      report: {
        ...reportOf([observation({}), observation({ subject: 'fixture:b', verdict: 'unchanged' })]),
        run: RUN,
      },
      reportDir: '/repo/out',
      store,
      subjects: [],
      all: true,
      read: async () => CANDIDATE,
      history,
      project: 'shop',
      now: () => '2026-08-10T12:00:00.000Z',
    });

    expect(approved[0]?.map((approval) => approval.subject)).toEqual(['fixture:a']);
  });
});
