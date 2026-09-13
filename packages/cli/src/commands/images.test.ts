import { describe, expect, it } from 'vitest';
import type { RenderDocument } from '@variance-authority/core/format';
import type { Found, RasterStore } from '@variance-authority/raster';
import type { Observation } from '@variance-authority/observe';
import type { RunDeps } from './run-context.js';
import { images } from './images.js';
import {
  BLACK,
  IDENTITY,
  WHITE,
  configOf,
  documentFor,
  fakeRenderer,
  rasterFor,
  storeAnswering,
} from './run-fixture.js';

/**
 * Which images a run leaves behind, per verdict.
 *
 * The function had no test of its own, and the thing worth pinning is not that it
 * writes a PNG — it is *which* verdicts get a pair. A subject that ships only its
 * candidate is a subject nobody can review against anything, and the rule for who
 * gets one had drifted: `ignored`, the one verdict that exists to be looked at
 * sceptically, was on the wrong side of it.
 */

const SUBJECT = 'fixture:a';

function candidateFor(document: RenderDocument, bytes: string) {
  return { ...rasterFor(document, IDENTITY), bytes };
}

function baselineOf(document: RenderDocument, bytes: string): Found {
  const raster = candidateFor(document, bytes);
  return { raster, comparable: true, storedUnder: raster.identity };
}

function observationOf(verdict: Observation['verdict']): Observation {
  return {
    subject: SUBJECT,
    verdict,
    because: `the fixture says ${verdict}`,
    regions: [],
    rendered: true,
    missingFonts: [],
  };
}

/** The candidate in the render cache, the baseline behind `find`, nothing on disk. */
async function writtenFor(
  verdict: Observation['verdict'],
  options: { baseline?: boolean; ephemeral?: boolean } = {},
): Promise<{ written: string[]; record: Awaited<ReturnType<typeof images>> }> {
  const document = documentFor(SUBJECT);
  const renderer = fakeRenderer();
  const store: RasterStore = storeAnswering(
    options.baseline === false ? null : baselineOf(document, BLACK),
  );
  await store.renderCache.put(candidateFor(document, WHITE));

  const written: string[] = [];
  const deps = {
    store,
    writeArtifact: async (path: string): Promise<void> => {
      written.push(path);
    },
  } as unknown as RunDeps;

  const record = await images(
    SUBJECT,
    observationOf(verdict),
    document,
    renderer,
    configOf(),
    deps,
    options.ephemeral === true ? null : { subject: SUBJECT },
  );
  return { written, record };
}

describe('which verdicts get a pair', () => {
  it('writes a before and a diff for a changed subject', async () => {
    const { written, record } = await writtenFor('changed');
    expect(written).toEqual([
      '/repo/out/images/fixture%3Aa.after.png',
      '/repo/out/images/fixture%3Aa.after.json',
      '/repo/out/images/fixture%3Aa.before.png',
      '/repo/out/images/fixture%3Aa.diff.png',
    ]);
    expect(record.images).toEqual({
      record: 'images/fixture%3Aa.after.json',
      before: 'images/fixture%3Aa.before.png',
      after: 'images/fixture%3Aa.after.png',
      diff: 'images/fixture%3Aa.diff.png',
    });
  });

  it('writes them for an ignored subject too, which is the one to be sceptical of', async () => {
    // `ignored` means pixels differed and a mask absorbed all of them. The
    // candidate alone shows the masked region looking exactly as intended — that
    // is what a mask does — so it is the only image that cannot answer whether
    // the mask has grown over a regression.
    const { record } = await writtenFor('ignored');
    expect(record.images).toEqual({
      record: 'images/fixture%3Aa.after.json',
      before: 'images/fixture%3Aa.before.png',
      after: 'images/fixture%3Aa.after.png',
      diff: 'images/fixture%3Aa.diff.png',
    });
  });

  it('writes only the candidate when nothing moved', async () => {
    const { record } = await writtenFor('unchanged');
    expect(record.images).toEqual({
      record: 'images/fixture%3Aa.after.json',
      after: 'images/fixture%3Aa.after.png',
    });
  });

  it('writes only the candidate for a subject with no baseline to subtract', async () => {
    const { record } = await writtenFor('changed', { baseline: false });
    expect(record.images).toEqual({
      record: 'images/fixture%3Aa.after.json',
      after: 'images/fixture%3Aa.after.png',
    });
  });

  it('writes only the candidate under ephemeral retention', async () => {
    const { record } = await writtenFor('changed', { ephemeral: true });
    expect(record.images).toEqual({
      record: 'images/fixture%3Aa.after.json',
      after: 'images/fixture%3Aa.after.png',
    });
  });
});
