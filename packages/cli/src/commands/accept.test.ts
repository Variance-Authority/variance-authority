import { describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core';
import type { BaselineKey, RasterStore } from '@variance-authority/raster';
import { createEphemeralStore } from '@variance-authority/raster';
import type { ObservationRecord } from '@variance-authority/report';
import { OperatorError } from '../exit.js';
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

describe('accept', () => {
  it('promotes the image the run already produced, and reads no renderer', async () => {
    // The rule the command exists for: acceptance re-bases a subject against an
    // image somebody reviewed, never against one produced here and now.
    const { store, puts } = recordingStore();

    const result = await accept({
      report: reportOf([observation({})]),
      reportDir: '/repo/out',
      store,
      subjects: ['fixture:a'],
      all: false,
      read: async (path) => {
        expect(path).toBe('/repo/out/images/fixture%3Aa.after.png');
        return CANDIDATE;
      },
    });

    expect(result.accepted).toEqual([
      { subject: 'fixture:a', from: 'images/fixture%3Aa.after.png' },
    ]);
    expect(puts).toEqual([[{ subject: 'fixture:a' }, CANDIDATE]]);
  });

  it('refuses a subject the run settled without rendering, rather than re-rendering it', async () => {
    // There is no image because none was needed for the verdict. Producing one
    // now would cross the identity partition the durable mode rests on.
    const { store, puts } = recordingStore();

    const result = await accept({
      report: reportOf([observation({ verdict: 'new', images: undefined })]),
      reportDir: '/repo/out',
      store,
      subjects: ['fixture:a'],
      all: false,
      read: async () => {
        throw new Error('accept must not read anything here');
      },
    });

    expect(puts).toHaveLength(0);
    expect(result.refused[0]?.because).toContain('never renders one');
  });

  it('explains an incomparable subject in terms of machines, not of code', async () => {
    // An agent handed "no image" would try to fix the component. The cause is a
    // baseline written elsewhere, and nothing in the source can address it.
    const { store } = recordingStore();

    const result = await accept({
      report: reportOf([observation({ verdict: 'incomparable', images: undefined })]),
      reportDir: '/repo/out',
      store,
      subjects: ['fixture:a'],
      all: false,
      read: async () => CANDIDATE,
    });

    expect(result.refused[0]?.because).toContain('another machine');
  });

  it('refuses a named subject that did not change, instead of silently doing nothing', async () => {
    const { store } = recordingStore();

    const result = await accept({
      report: reportOf([observation({ verdict: 'unchanged', images: undefined })]),
      reportDir: '/repo/out',
      store,
      subjects: ['fixture:a'],
      all: false,
      read: async () => CANDIDATE,
    });

    expect(result.refused[0]?.because).toContain('already is the baseline');
  });

  it('counts unchanged subjects under --all rather than omitting them', async () => {
    // "accepted 1" over a 300-subject run reads as though 299 were ignored for
    // some reason nobody stated.
    const { store, puts } = recordingStore();

    const result = await accept({
      report: reportOf([
        observation({}),
        observation({ subject: 'fixture:b', verdict: 'unchanged', images: undefined }),
      ]),
      reportDir: '/repo/out',
      store,
      subjects: [],
      all: true,
      read: async () => CANDIDATE,
    });

    expect(result.accepted).toHaveLength(1);
    expect(result.alreadyBaseline).toBe(1);
    expect(puts).toHaveLength(1);
  });

  it('refuses a subject the run never observed, quoting why it was not observed', async () => {
    const { store } = recordingStore();

    await expect(
      accept({
        report: reportOf([observation({})]),
        reportDir: '/repo/out',
        store,
        subjects: ['fixture:skipped'],
        all: false,
        read: async () => CANDIDATE,
      }),
    ).rejects.toThrow(/never became ready/);
  });

  it('refuses to guess between "accept nothing" and "accept everything"', async () => {
    const { store } = recordingStore();

    await expect(
      accept({
        report: reportOf([observation({})]),
        reportDir: '/repo/out',
        store,
        subjects: [],
        all: false,
        read: async () => CANDIDATE,
      }),
    ).rejects.toBeInstanceOf(OperatorError);
  });

  it('reports an unreadable candidate as a refusal, never as an acceptance', async () => {
    const { store, puts } = recordingStore();

    const result = await accept({
      report: reportOf([observation({})]),
      reportDir: '/repo/out',
      store,
      subjects: ['fixture:a'],
      all: false,
      read: async () => {
        throw new Error('is not a raster sidecar');
      },
    });

    expect(puts).toHaveLength(0);
    expect(result.accepted).toHaveLength(0);
    expect(result.refused[0]?.because).toContain('is not a raster sidecar');
  });
});

describe('formatAcceptance', () => {
  it('accounts for every subject: accepted, already the baseline, and refused', () => {
    const text = formatAcceptance({
      accepted: [{ subject: 'fixture:a', from: 'images/a.png' }],
      refused: [{ subject: 'fixture:b', because: 'no image' }],
      alreadyBaseline: 7,
    });

    expect(text).toContain('accepted 1 subject(s), 7 already the baseline, refused 1');
    expect(text).toContain('[accepted] fixture:a');
    expect(text).toContain('[refused]  fixture:b: no image');
  });
});
