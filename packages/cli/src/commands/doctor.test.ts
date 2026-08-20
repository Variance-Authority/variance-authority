import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { identityDigest } from '@variance-authority/core';
import type { Raster, RenderDocument, RenderIdentity, Viewport } from '@variance-authority/core';
import type { Renderer } from '@variance-authority/raster';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
import type { Config } from '../config.js';
import { doctor, fontProbeDocument, machineProbes, type DoctorProbes } from './doctor.js';
import { exitForDiagnosis, formatDiagnosis } from './doctor-report.js';

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

function probesWith(
  missingFonts: readonly string[],
  exists = true,
  partitions: readonly { identity: string; baselines: number }[] = [],
): DoctorProbes {
  return {
    async renderer(): Promise<Renderer> {
      return {
        identity: IDENTITY,
        async render(document: RenderDocument): Promise<Raster> {
          return {
            documentDigest: 'sha256-probe' as Raster['documentDigest'],
            identity: IDENTITY,
            width: 200,
            height: 40,
            bytes: '',
            missingFonts: document.fonts.length > 0 ? missingFonts : [],
          };
        },
        async close() {
          /* nothing to release */
        },
      };
    },
    exists: async () => exists,
    partitions: async () => partitions,
  };
}

function refusingProbes(): DoctorProbes {
  return {
    async renderer(): Promise<Renderer> {
      throw new Error('Executable does not exist at /ms-playwright/chromium/chrome');
    },
    exists: async () => true,
    partitions: async () => [],
  };
}

describe('doctor', () => {
  it('reports the renderer identity it actually opened, never a reconstructed one', async () => {
    // The identity is what a durable baseline is partitioned by. Printing one
    // assembled from package metadata would name a machine nobody stood on.
    const diagnosis = await doctor(configOf(), probesWith([]));

    expect(diagnosis.renderer.available).toBe(true);
    expect(diagnosis.renderer.identity).toEqual(IDENTITY);
  });

  it('states that a missing renderer means nothing was observed, not that nothing is wrong', async () => {
    const diagnosis = await doctor(configOf(), refusingProbes());

    expect(diagnosis.renderer.available).toBe(false);
    expect(diagnosis.renderer.because).toContain('Executable does not exist');
    expect(diagnosis.renderer.identity).toBeUndefined();
    expect(exitForDiagnosis(diagnosis)).toBe(EXIT_OPERATOR);
  });

  it('marks fonts as unprobed when there was no browser, rather than as none missing', async () => {
    // An empty `missing` list is the absence of a measurement. Rendering it as a
    // clean bill of health is the exact failure doctor exists to prevent.
    const diagnosis = await doctor(configOf(), refusingProbes());

    expect(diagnosis.fonts.probed).toBe(false);
    expect(diagnosis.fonts.missing).toEqual([]);
    expect(diagnosis.fonts.because).toContain('absence of a measurement');
  });

  it('reports a font the probe could not resolve, and refuses to call it absent', async () => {
    // The probe measures metrics, so a metric-compatible substitute reads as
    // missing. Saying "this machine lacks Inter" would be a claim it cannot make.
    const diagnosis = await doctor(configOf(), probesWith(['Inter']));

    expect(diagnosis.fonts.probed).toBe(true);
    expect(diagnosis.fonts.missing).toEqual(['Inter']);
    expect(diagnosis.fonts.because).toContain('metric-compatible substitutes');
  });

  it('does not fail the exit code on a font the probe reported missing', async () => {
    // A diagnostic that fails a build on a known false positive is a diagnostic
    // somebody deletes, and then the real signal goes with it.
    expect(exitForDiagnosis(await doctor(configOf(), probesWith(['Inter'])))).toBe(EXIT_CLEAN);
  });

  it('says a config asserting no fonts leaves the identity unable to tell machines apart', async () => {
    const diagnosis = await doctor(configOf({ fonts: [] }), probesWith([]));

    expect(diagnosis.fonts.probed).toBe(false);
    expect(diagnosis.fonts.because).toContain('cannot distinguish two machines');
  });

  it('reports a remote store as configured and explicitly not contacted', async () => {
    // Doctor makes no network calls: an answer that depended on a firewall would
    // be a different answer tomorrow, and a diagnostic must not write to a service.
    const diagnosis = await doctor(
      configOf({ baselines: { kind: 'remote', endpoint: 'http://box:7788' } }),
      probesWith([]),
    );

    expect(diagnosis.baselines.kind).toBe('remote');
    expect(diagnosis.baselines.because).toContain('not contacted');
  });

  it('says a missing baseline root means every subject is `new`, not that it passed', async () => {
    const diagnosis = await doctor(configOf(), probesWith([], false));
    expect(diagnosis.baselines.because).toContain('`new` on the first');
  });

  it('says an absent history store is nobody asking, not an absence of drift', async () => {
    // The distinction `createAbsentStore` protects: "0 changes in 0 runs" reads
    // as stability and is a confident answer to a question nobody asked.
    const diagnosis = await doctor(configOf(), probesWith([]));

    expect(diagnosis.history.configured).toBe(false);
    expect(diagnosis.history.because).toContain('not evidence of stability');
  });

  it('reports a configured history store without contacting it', async () => {
    const diagnosis = await doctor(
      configOf({ history: { endpoint: 'http://history:7788', token: 't' } }),
      probesWith([]),
    );

    expect(diagnosis.history.configured).toBe(true);
    expect(diagnosis.history.because).toContain('not contacted');
  });
});

describe('fontProbeDocument', () => {
  it('marks the subject root so a renderer has something to clip to', () => {
    // Without the path attribute the renderer finds no subject, the probe throws,
    // and the font check silently degrades to "not probed" forever.
    expect(fontProbeDocument([], VIEWPORT).html).toContain('data-va-path="0"');
  });

  it('carries the asserted font identities through unchanged', () => {
    // The renderer extracts families itself; converting them here would be a
    // second place that decides what a font identity is.
    const document = fontProbeDocument(['Inter/400/normal/sha256-abc'], VIEWPORT);
    expect(document.fonts).toEqual(['Inter/400/normal/sha256-abc']);
    expect(document.viewport).toBe(VIEWPORT);
  });
});

describe('formatDiagnosis', () => {
  it('prints the font probe’s known limit whenever a probe actually ran', async () => {
    // The limit is the reason a missing font here is not a build failure, so it
    // has to travel with the finding rather than live only in a doc comment.
    const text = formatDiagnosis(await doctor(configOf(), probesWith(['Inter'])));

    expect(text).toContain('known limit');
    expect(text).toContain('Liberation Sans');
    expect(text).toContain('does not change the exit code');
  });

  it('does not claim a limit for a probe that never ran', async () => {
    const text = formatDiagnosis(await doctor(configOf(), refusingProbes()));

    expect(text).toContain('NOT AVAILABLE');
    expect(text).toContain('fonts: not probed');
    expect(text).not.toContain('known limit');
  });
});

/**
 * The partition probe, against a real directory.
 *
 * Everything above injects probes; this is the one place the filesystem walk is
 * asked what it sees, because the sentence it produces — *these baselines were
 * painted by a machine you are not* — is the answer that otherwise costs an
 * afternoon, and it is produced from directory names alone.
 */
describe('machineProbes partitions', () => {
  const identity = identityDigest(IDENTITY);
  const other = identityDigest({ ...IDENTITY, platform: 'darwin/arm64' });
  const roots: string[] = [];

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function rootWith(files: readonly string[]): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'variance-doctor-'));
    roots.push(root);
    for (const file of files) {
      await mkdir(join(root, dirname(file)), { recursive: true });
      await writeFile(join(root, file), '', 'utf8');
    }
    return root;
  }

  it('counts a flat root', async () => {
    const root = await rootWith([`${identity}/a.png`, `${identity}/b.png`, `${other}/a.png`]);

    expect(await machineProbes(configOf()).partitions(root)).toEqual([
      { identity, baselines: 2 },
      { identity: other, baselines: 1 },
    ]);
  });

  it('finds partitions a `beside` layout put next to the components', async () => {
    // A scan one level deep answers "this root holds nothing" for a root full of
    // baselines, and a doctor that is wrong in the direction of fine is worse
    // than no doctor.
    const root = await rootWith([
      `src/ui/Button/${identity}/primary.png`,
      `src/ui/Card/${identity}/wide.png`,
    ]);

    expect(await machineProbes(configOf()).partitions(root)).toEqual([{ identity, baselines: 2 }]);
  });

  it('does not read a render cache as a machine', async () => {
    // `by-document` is a directory inside a partition. Counting it would report
    // a second machine that does not exist, on every store whose cache sits
    // beside its baselines.
    const root = await rootWith([`${identity}/a.png`, `${identity}/by-document/v1:doc.png`]);

    expect(await machineProbes(configOf()).partitions(root)).toEqual([{ identity, baselines: 1 }]);
  });

  it('reports nothing for a root that is not there', async () => {
    expect(await machineProbes(configOf()).partitions(join(tmpdir(), 'variance-doctor-absent')))
      .toEqual([]);
  });
});
