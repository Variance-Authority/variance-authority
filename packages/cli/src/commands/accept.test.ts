import { describe, expect, it } from 'vitest';
import type { Raster, RenderIdentity } from '@variance-authority/core/format';
import type { BaselineKey, RasterStore } from '@variance-authority/raster';
import { createEphemeralStore } from '@variance-authority/raster';
import type { ObservationRecord } from '@variance-authority/report';
import { OperatorError } from '../exit.js';
import { accept, formatAcceptance } from './accept.js';
import type { CliObservationRecord, CliRunReport } from './run.js';

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

function observation(overrides: Partial<CliObservationRecord>): CliObservationRecord {
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

function reportOf(observations: readonly CliObservationRecord[]): CliRunReport {
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

  it('refuses a change that vanished in a clean world, image or no image', async () => {
    // The one refusal that is about the *content* of the candidate. The image is
    // right there and perfectly readable; promoting it writes a render the
    // session poisoned as the thing every later run is measured against, and the
    // subject then compares `unchanged` for as long as the leak survives — the
    // failure baselined along with the pixels.
    const { store, puts } = recordingStore();

    const result = await accept({
      report: reportOf([
        observation({
          alone: { reproduced: false, because: 're-collected alone, it matches its baseline' },
        }),
      ]),
      reportDir: '/repo/out',
      store,
      subjects: ['fixture:a'],
      all: false,
      read: async () => CANDIDATE,
    });

    expect(puts).toHaveLength(0);
    expect(result.refused[0]?.because).toContain('would make the leak the baseline');
  });

  it('accepts a change that reproduced alone, because that is a component change', async () => {
    // The other half, and it has to be asserted: a check that only ever refuses
    // is indistinguishable from a broken accept.
    const { store, puts } = recordingStore();

    const result = await accept({
      report: reportOf([
        observation({ alone: { reproduced: true, because: 'the change is still there' } }),
      ]),
      reportDir: '/repo/out',
      store,
      subjects: ['fixture:a'],
      all: false,
      read: async () => CANDIDATE,
    });

    expect(result.refused).toHaveLength(0);
    expect(puts).toEqual([[{ subject: 'fixture:a' }, CANDIDATE]]);
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

  it('keeps an unstable unchanged subject out of the baseline count', async () => {
    const { store } = recordingStore();

    const result = await accept({
      report: reportOf([
        observation({
          verdict: 'unchanged',
          images: undefined,
          unstable: {
            components: [{ name: 'Clock' }],
            bands: ['content'],
            because: 'Clock read differently (content)',
          },
        }),
      ]),
      reportDir: '/repo/out',
      store,
      subjects: ['fixture:a'],
      all: false,
      read: async () => CANDIDATE,
    });

    expect(result.alreadyBaseline).toBe(0);
    expect(result.refused[0]?.because).toContain('Clock read differently (content)');
    expect(result.refused[0]?.because).toContain('one of two readings');
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

describe('accepting a difference shape', () => {
  const region = (fingerprint: string, pixels = 40) => ({
    x: 0,
    y: 0,
    width: 10,
    height: 4,
    pixels,
    cause: false,
    fingerprint,
  });

  const FLAKE = 'v1:2c4f9a1e0b7d3856a91c4e2f8b06d735';
  const OTHER = 'v1:ffffffffffffffffffffffffffffffff';

  async function acceptShape(
    observations: readonly ObservationRecord[],
    shapes: readonly string[],
  ) {
    const { store, puts } = recordingStore();
    const result = await accept({
      report: reportOf(observations),
      reportDir: '/repo/out',
      store,
      subjects: [],
      all: false,
      shapes,
      read: async () => CANDIDATE,
    });
    return { result, puts };
  }

  it('covers every subject the shape reached, in one action', async () => {
    // The bulk path. One change across forty screenshots is one decision, and
    // the shape is what makes "the same change" a fact rather than a hope.
    const { result } = await acceptShape(
      [
        observation({ subject: 'fixture:a', regions: [region(FLAKE)] }),
        observation({ subject: 'fixture:b', regions: [region(FLAKE)] }),
        observation({ subject: 'fixture:c', regions: [region(OTHER)] }),
      ],
      [FLAKE],
    );

    expect(result.accepted.map((entry) => entry.subject)).toEqual(['fixture:a', 'fixture:b']);
  });

  it('leaves a subject where something else also moved, and names it', async () => {
    // The safety property, and the reason a bulk accept is defensible at all.
    // Sweeping this one along would baseline the other change silently — and
    // saying nothing about it would be its own surprise.
    const { result, puts } = await acceptShape(
      [observation({ subject: 'fixture:a', regions: [region(FLAKE), region(OTHER)] })],
      [FLAKE],
    );

    expect(result.accepted).toEqual([]);
    expect(puts).toEqual([]);
    expect(result.refused[0]?.because).toContain('something else changed too');
  });

  it('names a partial subject even when others were accepted', async () => {
    const { result } = await acceptShape(
      [
        observation({ subject: 'fixture:a', regions: [region(FLAKE)] }),
        observation({ subject: 'fixture:b', regions: [region(FLAKE), region(OTHER)] }),
      ],
      [FLAKE],
    );

    expect(result.accepted.map((entry) => entry.subject)).toEqual(['fixture:a']);
    expect(result.refused.map((entry) => entry.subject)).toEqual(['fixture:b']);
  });

  it('leaves a subject whose region list was capped', async () => {
    // A truncated list is not a complete one, so "this shape is the entire
    // change" is unsupported — the regions the run dropped could be anything.
    const { result } = await acceptShape(
      [
        observation({
          subject: 'fixture:a',
          regions: [region(FLAKE)],
          truncated: { regions: 3, pixels: 90 },
        }),
      ],
      [FLAKE],
    );

    expect(result.accepted).toEqual([]);
    expect(result.refused[0]?.because).toContain('capped its region list');
  });

  it('refuses the whole command when the shape appears nowhere at all', async () => {
    // "accepted 0 subjects" and "that fingerprint does not appear in this run"
    // are different answers, and only one of them tells the operator to check
    // what they pasted.
    await expect(
      acceptShape([observation({ subject: 'fixture:a', regions: [region(OTHER)] })], [FLAKE]),
    ).rejects.toBeInstanceOf(OperatorError);
  });

  it('takes several shapes at once', async () => {
    const { result } = await acceptShape(
      [
        observation({ subject: 'fixture:a', regions: [region(FLAKE)] }),
        observation({ subject: 'fixture:b', regions: [region(FLAKE), region(OTHER)] }),
      ],
      [FLAKE, OTHER],
    );

    expect(result.accepted.map((entry) => entry.subject)).toEqual(['fixture:a', 'fixture:b']);
  });
});

/**
 * Where an accepted image is written, for a store that places by path.
 *
 * `accept` never re-plans — it reads a report and the images beside it — so the
 * directory has to arrive in the report or not at all. Losing it here is silent
 * and total: every accepted baseline lands in the root, the next run looks in
 * the placement the config asked for, finds nothing, and reports `new`.
 */
describe('the placement an acceptance carries', () => {
  it('hands the store the directory the run recorded', async () => {
    const { store, puts } = recordingStore();

    await accept({
      report: reportOf([observation({ placement: 'src/ui/shell' })]),
      reportDir: '/reports',
      store,
      subjects: ['fixture:a'],
      all: false,
      read: async () => CANDIDATE,
    });

    expect(puts[0]?.[0]).toEqual({ subject: 'fixture:a', path: 'src/ui/shell' });
  });

  it('omits the path when the run recorded none, rather than inventing one', async () => {
    const { store, puts } = recordingStore();

    await accept({
      report: reportOf([observation({})]),
      reportDir: '/reports',
      store,
      subjects: ['fixture:a'],
      all: false,
      read: async () => CANDIDATE,
    });

    expect(puts[0]?.[0]).toEqual({ subject: 'fixture:a' });
  });

  it('carries a root placement as the root, which is not the same as none', async () => {
    const { store, puts } = recordingStore();

    await accept({
      report: reportOf([observation({ placement: '' })]),
      reportDir: '/reports',
      store,
      subjects: ['fixture:a'],
      all: false,
      read: async () => CANDIDATE,
    });

    expect(puts[0]?.[0]).toEqual({ subject: 'fixture:a', path: '' });
  });
});
