import { describe, expect, it } from 'vitest';
import { identityDigest } from '@variance-authority/core/format';
import type {
  Raster,
  RenderDocument,
  RenderIdentity,
  Viewport,
} from '@variance-authority/core/format';
import type { Renderer } from '@variance-authority/raster';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
import type { Config } from '../config.js';
import { doctor, type DoctorProbes } from './doctor.js';
import { exitForDiagnosis, formatDiagnosis } from './doctor-report.js';

/**
 * The question that used to be deferred to a run: *can this machine compare
 * against what is in the store at all?*
 *
 * It is the failure mode of every tool that renders in your CI and stores images
 * somewhere shared, and it does not present as a configuration error — it
 * presents as three hundred components regressing at once on a runner nobody
 * touched. The store's layout is `<root>/<identityDigest>/<subject>.png`, so the
 * answer is a `readdir`, and until now this file's subject said it was "a
 * question only a run can answer".
 *
 * No browser and no filesystem: the partition scan is a probe, so every case
 * below is a list of directory names.
 */

const VIEWPORT: Viewport = {
  width: 1280,
  height: 800,
  deviceScaleFactor: 1,
  colorScheme: 'light',
};

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/sha256-abc'],
};

/** What a run on this machine would write under. */
const MINE = identityDigest(IDENTITY);
const THEIRS = identityDigest({ ...IDENTITY, platform: 'darwin/arm64' });

function configOf(overrides: Partial<Config> = {}): Config {
  return {
    project: 'test',
    profile: 'chromium',
    viewport: VIEWPORT,
    retention: 'durable',
    subjects: { kind: 'list', ids: ['fixture:a'], collector: '/repo/collector.mjs' },
    baselines: { kind: 'directory', root: '/repo/baselines' },
    fonts: ['Inter/400/normal/sha256-abc'],
    report: '/repo/out/report.json',
    images: '/repo/out/images',
    ...overrides,
  };
}

function probesOf(
  partitions: readonly { identity: string; baselines: number }[],
  options: { readonly opens?: boolean; readonly exists?: boolean } = {},
): DoctorProbes {
  return {
    async renderer(): Promise<Renderer> {
      if (options.opens === false) throw new Error('no browser here');
      return {
        identity: IDENTITY,
        identityFor: () => IDENTITY,
        async render(_document: RenderDocument): Promise<Raster> {
          return {
            width: 10,
            height: 10,
            identity: IDENTITY,
            documentDigest: 'sha256-fixture',
            bytes: '',
            missingFonts: [],
          } as unknown as Raster;
        },
        async close() {
          /* nothing to release */
        },
      };
    },
    exists: async () => options.exists !== false,
    partitions: async () => partitions,
  };
}

describe('a store this machine cannot compare against', () => {
  const foreign = () => doctor(configOf(), probesOf([{ identity: THEIRS, baselines: 342 }]));

  it('is found before the run rather than during it', async () => {
    const { baselines } = await foreign();
    expect(baselines.comparable).toBe(false);
    expect(baselines.because).toContain('no baseline in /repo/baselines was painted by a machine');
  });

  it('names both exits instead of only the diagnosis', async () => {
    // A finding an operator cannot act on is a finding they learn to scroll past.
    // Both ways out are real and are in this repository: ephemeral retention, or
    // a renderer endpoint carrying the identity the baselines were written under.
    const { baselines } = await foreign();
    expect(baselines.because).toContain('"retention": "ephemeral"');
    expect(baselines.because).toContain('"renderer"');
  });

  it('exits 2, because a run here would produce no verdicts at all', async () => {
    expect(exitForDiagnosis(await foreign())).toBe(EXIT_OPERATOR);
  });

  it('lays the store out by identity, marking this machine', async () => {
    const text = formatDiagnosis(await foreign());
    expect(text).toContain('NOT COMPARABLE HERE');
    expect(text).toContain(THEIRS.slice(0, 16));
  });
});

describe('a store this machine wrote', () => {
  it('says so, and exits clean', async () => {
    const diagnosis = await doctor(configOf(), probesOf([{ identity: MINE, baselines: 8 }]));

    expect(diagnosis.baselines.comparable).toBe(true);
    expect(diagnosis.baselines.because).toContain('8 baseline(s)');
    expect(exitForDiagnosis(diagnosis)).toBe(EXIT_CLEAN);
    expect(formatDiagnosis(diagnosis)).toContain('(this machine)');
  });

  it('still lists the identities it does not own', async () => {
    // The number that matters is not "can I compare" but "against how much". Four
    // baselines here and nine hundred there is a suite that was resharded and
    // nobody noticed, and it reads as fine until it is laid out.
    const diagnosis = await doctor(
      configOf(),
      probesOf([
        { identity: THEIRS, baselines: 900 },
        { identity: MINE, baselines: 4 },
      ]),
    );

    expect(diagnosis.baselines.comparable).toBe(true);
    expect(diagnosis.baselines.partitions).toEqual([
      { identity: THEIRS, baselines: 900, mine: false },
      { identity: MINE, baselines: 4, mine: true },
    ]);
    expect(diagnosis.baselines.because).toContain('other 1 identit(ies)');
  });
});

describe('states that are not a wrong machine', () => {
  it('an empty root is the first run, not a mismatch', async () => {
    // The two come from one `readdir` and give opposite advice. Collapsing them
    // would tell somebody setting the tool up for the first time that their
    // machine is wrong.
    const diagnosis = await doctor(configOf(), probesOf([]));

    expect(diagnosis.baselines.comparable).toBeUndefined();
    expect(diagnosis.baselines.because).toContain('will be `new` on the first run');
    expect(exitForDiagnosis(diagnosis)).toBe(EXIT_CLEAN);
  });

  it('a root of empty identity directories is also the first run', async () => {
    const diagnosis = await doctor(configOf(), probesOf([{ identity: THEIRS, baselines: 0 }]));
    expect(diagnosis.baselines.comparable).toBeUndefined();
  });

  it('an absent root is never scanned', async () => {
    const diagnosis = await doctor(configOf(), probesOf([], { exists: false }));
    expect(diagnosis.baselines.partitions).toBeUndefined();
    expect(diagnosis.baselines.because).toContain('does not exist yet');
  });

  it('says it cannot tell when no renderer opened', async () => {
    // No digest to compare against, so reporting a mismatch would be inventing
    // the bad news rather than finding it — and the exit code is already 2 for
    // the renderer, which is the thing to fix first.
    const diagnosis = await doctor(
      configOf(),
      probesOf([{ identity: THEIRS, baselines: 12 }], { opens: false }),
    );

    expect(diagnosis.baselines.comparable).toBeUndefined();
    expect(diagnosis.baselines.because).toContain('no renderer opened here to be asked');
    expect(exitForDiagnosis(diagnosis)).toBe(EXIT_OPERATOR);
  });

  it('never scans an ephemeral or remote store', async () => {
    const ephemeral = await doctor(configOf({ retention: 'ephemeral' }), probesOf([]));
    expect(ephemeral.baselines.partitions).toBeUndefined();

    const remote = await doctor(
      configOf({ baselines: { kind: 'remote', endpoint: 'https://baselines', token: 't' } }),
      probesOf([]),
    );
    expect(remote.baselines.partitions).toBeUndefined();
    expect(remote.baselines.because).toContain('deliberately not contacted');
  });
});
