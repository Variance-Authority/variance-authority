import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  documentDigest,
  environmentKey,
  profileById,
  type Diagnostic,
  type RenderDocument,
  type RenderIdentity,
  type SemanticSnapshot,
} from '@variance-authority/core';
import {
  RasterStoreError,
  createEphemeralStore,
  type Found,
  type RasterStore,
  type Renderer,
} from '@variance-authority/raster';
import type { Config } from '../config.js';
import { EXIT_CLEAN, EXIT_REVIEW, OperatorError, exitFor } from '../exit.js';
import { matchesGlob, readCliRunReport, storeFor, type Collected, type Plan } from './run.js';
import {
  DANGLING,
  IDENTITY,
  UNREADABLE,
  VIEWPORT,
  collectorOf,
  configOf,
  documentFor,
  rasterFor,
  runWith,
  storeAnswering,
} from './run-fixture.js';

/**
 * The run itself: which subjects were looked at, which were not, and what the
 * artifact says about both.
 *
 * The per-subject decisions have their own files — `settle.test.ts`,
 * `record.test.ts`, `alone.test.ts` — so everything here is about the loop and
 * its outputs. `matchesGlob` is in this file rather than beside the collector it
 * now lives with, because the only thing it decides is `--subjects`, and the
 * behaviour that matters is two tests below: a subject the glob refuses is
 * *listed as excluded*, never dropped.
 */

/** The same document, with the collector's complaints attached to it. */
function documentWith(id: string, diagnostics: readonly Diagnostic[]): RenderDocument {
  return { ...documentFor(id), diagnostics };
}

/** A snapshot carrying diagnostics, and otherwise the emptiest one that type-checks. */
function snapshotWith(id: string, diagnostics: readonly Diagnostic[]): SemanticSnapshot {
  return {
    formatVersion: 1,
    subject: { id, kind: 'fixture' },
    profile: profileById('chromium'),
    environment: environmentKey({
      profile: 'chromium',
      engine: 'chromium@131',
      ruleset: 'test',
      allowlist: 'test',
      viewport: VIEWPORT,
      fonts: [],
      conditions: {},
      assets: {},
    }),
    renderHash: 'v1:0',
    structureHash: 'v1:0',
    styleHash: 'v1:0',
    root: { path: '0', tag: 'div', attributes: {}, style: {}, children: [] },
    styleProvenance: [],
    diagnostics,
  };
}

describe('matchesGlob', () => {
  it('matches `*` across any characters, including a colon', () => {
    // Subject ids are namespaced identifiers, not paths. A path-aware glob would
    // stop at a separator that carries no meaning here.
    expect(matchesGlob('story:*', 'story:components-button--primary')).toBe(true);
    expect(matchesGlob('*button*', 'story:components-button--primary')).toBe(true);
    expect(matchesGlob('story:*', 'fixture:button')).toBe(false);
  });

  it('anchors the whole id rather than matching a substring', () => {
    expect(matchesGlob('button', 'story:button')).toBe(false);
  });

  it('treats regex metacharacters in the pattern as literals', () => {
    // `story:a.b` must not match `story:axb`; a pattern is a glob, not a regex.
    expect(matchesGlob('story:a.b', 'story:axb')).toBe(false);
    expect(matchesGlob('story:a.b', 'story:a.b')).toBe(true);
  });
});

describe('run', () => {
  const plan: Plan = {
    subjects: [
      { subject: { id: 'fixture:a', kind: 'fixture' } },
      { subject: { id: 'fixture:b', kind: 'fixture' } },
    ],
    notObserved: [{ subject: 'fixture:x', kind: 'excluded', because: 'tagged `!test`' }],
    warnings: ['the index declared 1 entry this adapter does not understand'],
  };

  const collectsBoth = collectorOf(plan, (subject) => ({
    ok: true,
    document: documentFor(subject.subject.id),
  }));

  it('settles unchanged subjects without asking the renderer for an image', async () => {
    // The measurable claim: 300 subjects, 0 renders *and 0 image reads* when
    // nothing moved.
    let renders = 0;
    let images = 0;
    const renderer: Renderer = {
      identity: IDENTITY,
      identityFor(document) {
        return { ...IDENTITY, deviceScaleFactor: document.viewport.deviceScaleFactor };
      },
      async render(document) {
        renders += 1;
        return rasterFor(document, IDENTITY);
      },
      async close() {
        /* nothing */
      },
    };

    const found = (id: string): Found => ({
      raster: rasterFor(documentFor(id), IDENTITY),
      comparable: true,
      storedUnder: IDENTITY,
    });

    const store: RasterStore = {
      ...createEphemeralStore(),
      async find(key) {
        images += 1;
        return found(key.subject);
      },
      async describe(key) {
        return {
          documentDigest: documentDigest(documentFor(key.subject)),
          comparable: true,
          storedUnder: IDENTITY,
          missingFonts: [],
        };
      },
    };

    const { report } = await runWith(configOf(), collectsBoth, store, { renderer });

    expect(renders).toBe(0);
    // And no image was *read* either, which is the half of the claim that used
    // not to hold: the settled path went through `find`, so a suite where
    // nothing moved still moved every baseline PNG in order to compare 32 hex
    // characters. `describe` answers from the sidecar, so a fully-settled run
    // now touches no image on either side.
    expect(images).toBe(0);
    expect(report.observations.map((entry) => entry.verdict)).toEqual([
      'unchanged',
      'unchanged',
    ]);
  });

  it('carries the plan’s own exclusions into the report', async () => {
    // A subject that vanishes without a word is indistinguishable from one that
    // passed. The adapter's reason has to reach the artifact, not a log line.
    const { report } = await runWith(configOf(), collectsBoth, storeAnswering(null));

    expect(report.notObserved).toContainEqual({
      subject: 'fixture:x',
      kind: 'excluded',
      because: 'tagged `!test`',
    });
  });

  it('lists a subject the glob filtered out, rather than dropping it', async () => {
    const { report } = await runWith(configOf(), collectsBoth, storeAnswering(null), {
      subjects: 'fixture:a',
    });

    expect(report.observations).toHaveLength(1);
    expect(report.notObserved).toContainEqual({
      subject: 'fixture:b',
      kind: 'excluded',
      because: 'did not match --subjects fixture:a',
    });
  });

  it('records a collector failure as `failed`, and keeps observing the rest', async () => {
    // One component that throws must not cost the other 299 their observations,
    // and must not be silently absent from the report either.
    const collector = collectorOf(plan, (subject): Collected =>
      subject.subject.id === 'fixture:a'
        ? { ok: false, because: 'the story never became ready within 15000ms' }
        : { ok: true, document: documentFor(subject.subject.id) },
    );

    const { report } = await runWith(configOf(), collector, storeAnswering(null));

    expect(report.observations.map((entry) => entry.subject)).toEqual(['fixture:b']);
    expect(report.notObserved).toContainEqual({
      subject: 'fixture:a',
      kind: 'failed',
      because: 'the story never became ready within 15000ms',
    });
  });

  it('reports an ephemeral subject with no previous document as failed, not as passing', async () => {
    // Ephemeral retention renders both sides now. With only one side there is no
    // comparison, and an unobservable difference is never no difference.
    const { baselines, ...durable } = configOf();
    void baselines;
    const config: Config = { ...durable, retention: 'ephemeral' };

    const { report } = await runWith(config, collectsBoth, createEphemeralStore());

    expect(report.observations).toHaveLength(0);
    expect(report.notObserved).toContainEqual({
      subject: 'fixture:a',
      kind: 'failed',
      because: expect.stringContaining('no previous-revision document'),
    });
  });

  it('turns a baseline-store failure into an operator error, never into a verdict', async () => {
    // Spec 0004: an unreachable endpoint reported as `new` would make the next
    // `accept` overwrite the only copy of what the subject looked like before.
    const store = storeAnswering(() => {
      throw new RasterStoreError('store http://box:7788 could not be reached');
    });

    await expect(runWith(configOf(), collectsBoth, store)).rejects.toBeInstanceOf(OperatorError);
  });

  it('writes the report to the configured path and returns the same value', async () => {
    const { report, written } = await runWith(configOf(), collectsBoth, storeAnswering(null));
    expect(written.reports).toEqual([report]);
  });

  it('leaves the candidate image and its sidecar beside the report', async () => {
    // `accept` promotes an image the run produced and never renders one, so the
    // bytes and the identity that painted them both have to survive the run.
    const { written } = await runWith(configOf(), collectsBoth, storeAnswering(null));

    expect([...written.artifacts.keys()]).toContain('/repo/out/images/fixture%3Aa.after.png');
    expect([...written.artifacts.keys()]).toContain('/repo/out/images/fixture%3Aa.after.json');

    const sidecar = JSON.parse(
      written.artifacts.get('/repo/out/images/fixture%3Aa.after.json')!.toString('utf8'),
    ) as { documentDigest: string; identity: RenderIdentity };
    expect(sidecar.documentDigest).toBe(documentDigest(documentFor('fixture:a')));
    expect(sidecar.identity.deviceScaleFactor).toBe(2);
  });

  const onlyA: Plan = {
    subjects: [{ subject: { id: 'fixture:a', kind: 'fixture' } }],
    notObserved: [],
    warnings: [],
  };

  /**
   * A store holding the baseline this document was painted from: the settled path.
   *
   * `describe` is the one the run actually reaches here — settling reads the
   * sidecar and never the image — and `find` is kept in agreement so a test that
   * moves off this path finds a coherent store rather than an empty one.
   */
  function settlingStore(missingFonts: readonly string[] = []): RasterStore {
    return {
      ...createEphemeralStore(),
      async find(key) {
        return {
          raster: { ...rasterFor(documentFor(key.subject), IDENTITY), missingFonts },
          comparable: true,
          storedUnder: IDENTITY,
        };
      },
      async describe(key) {
        return {
          documentDigest: documentDigest(documentFor(key.subject)),
          comparable: true,
          storedUnder: IDENTITY,
          missingFonts,
        };
      },
    };
  }

  it('carries the collector’s diagnostics to the verdict instead of dropping them', async () => {
    // The missed detection this closes: a subject whose design system is served
    // from a cross-origin `<link>` is collected without those rules, compared
    // against a baseline collected the same way, and reports `unchanged` — the
    // pixels really do match, because both sides are missing the same styling.
    // Nothing in the verdict can see that, so the diagnostic has to reach the
    // record and the exit code, from the settled path as much as the rendered one.
    const collector = collectorOf(onlyA, (subject) => ({
      ok: true,
      document: documentWith(subject.subject.id, [UNREADABLE]),
      snapshot: snapshotWith(subject.subject.id, [DANGLING]),
    }));

    const { report } = await runWith(configOf(), collector, settlingStore());

    expect(report.observations[0]?.verdict).toBe('unchanged');
    expect(report.observations[0]?.diagnostics).toEqual([UNREADABLE, DANGLING]);
    expect(exitFor(report)).toBe(EXIT_REVIEW);
  });

  it('does not hold a run open for a warn, which states a limit rather than a hole', async () => {
    // The counterweight to the test above: `unverified-fonts` and its kind fire on
    // every subject of a suite that supplied no font hashes, and gating on them
    // would make that suite permanently red — which ends with the gate switched
    // off. Recorded, not gated.
    const collector = collectorOf(onlyA, (subject) => ({
      ok: true,
      document: documentWith(subject.subject.id, [DANGLING]),
    }));

    const { report } = await runWith(configOf(), collector, settlingStore());

    expect(report.observations[0]?.diagnostics).toEqual([DANGLING]);
    expect(exitFor(report)).toBe(EXIT_CLEAN);
  });

  it('records the fonts the baseline was painted without on a digest-settled subject', async () => {
    // The digest short-circuit is sound about pixels and is not entitled to drop a
    // fact the baseline already recorded: a bare `unchanged` about a substituted
    // font tells the reader the subject is fine, in a sentence produced by a
    // comparison that never looked at the typeface.
    const collector = collectorOf(onlyA, (subject) => ({
      ok: true,
      document: documentFor(subject.subject.id),
    }));

    const { report } = await runWith(configOf(), collector, settlingStore(['Inter']));

    expect(report.observations[0]).toMatchObject({
      verdict: 'unchanged',
      missingFonts: ['Inter'],
    });
    expect(report.observations[0]?.because).toContain('substituted font');
  });

  it('states in the report that a profile without layout cannot attribute regions', async () => {
    // Otherwise the limit is discovered from a report full of coordinates with no
    // names, and read as the tool failing rather than as the profile's declared
    // blindness (ADR-0002).
    const { report } = await runWith(
      configOf({ profile: 'jsdom' }),
      collectsBoth,
      storeAnswering(null),
    );

    expect(report.warnings?.join('\n')).toContain('no layout engine');
  });
});

describe('readCliRunReport', () => {
  it('refuses a diagnostic whose severity is neither warn nor error', async () => {
    // The exit code now rests on this field, and a report is a file people edit by
    // hand while triaging. Reading an unknown severity as `warn` would let a hole
    // in the coverage exit 0; reading it as `error` would hold every run open on a
    // typo. Neither guess is available.
    const directory = await mkdtemp(join(tmpdir(), 'variance-cli-'));
    const path = join(directory, 'report.json');

    await writeFile(
      path,
      JSON.stringify({
        runVersion: 1,
        at: '2026-08-01T00:00:00.000Z',
        identity: IDENTITY,
        retention: 'durable',
        observations: [
          {
            subject: 'fixture:a',
            verdict: 'unchanged',
            because: 'no pixels differ',
            changedPixels: 0,
            regions: [],
            diagnostics: [{ severity: 'fatal', code: 'x', message: 'y' }],
          },
        ],
        notObserved: [],
      }),
      'utf8',
    );

    try {
      await expect(readCliRunReport(path)).rejects.toThrow(/neither "warn" nor "error"/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

describe('storeFor', () => {
  const made: string[] = [];

  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(made.splice(0).map((path) => rm(path, { recursive: true, force: true })));
  });

  async function directory(prefix: string): Promise<string> {
    const path = await mkdtemp(join(tmpdir(), prefix));
    made.push(path);
    return path;
  }

  it('keeps the regenerable render cache out of the LFS-tracked baseline tree', async () => {
    // The cache is keyed by document digest, so it gains an entry per edit and is
    // worth nothing after one. Under the tracked root it is committed like a
    // baseline: every run adds megabytes of PNGs to the object database that
    // nobody will ever read, and the LFS quota pays for it forever.
    const root = await directory('variance-baselines-');
    const cache = await directory('variance-cache-');
    vi.stubEnv('XDG_CACHE_HOME', cache);

    const store = await storeFor(configOf({ baselines: { kind: 'lfs', root } }));
    const raster = rasterFor(documentFor('fixture:a'), IDENTITY);
    await store.renderCache.put(raster);

    // Still a cache: pushing it out of the work tree must not cost the hit that
    // pays for the whole deferral.
    expect(await store.renderCache.get(raster.documentDigest, raster.identity)).not.toBeNull();
    // Only the tracking entry the store writes on the way in.
    expect(await readdir(root)).toEqual(['.gitattributes']);
  });
});
