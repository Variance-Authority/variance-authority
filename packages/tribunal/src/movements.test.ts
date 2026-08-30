import { beforeEach, describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core';
import type { CompositionReport, MovementRecord, RunReport } from '@variance-authority/report';
import { createReviewStore, type ReviewStore } from './review.js';
import { createMemoryR2, createSqliteD1, type SqliteD1 } from './testing.js';

/**
 * The census and the run's reading of it, from the report to the review page.
 *
 * The reading is the half that was dropped. A run walks the diff, resolves which
 * file declares each component that moved, climbs the enclosure graph when no
 * file does, and writes one sentence per movement into `composition.movements` —
 * and the ingest wrote the graph and none of the conclusions. The page then
 * re-derived a weaker answer from the edges alone, without the diff, the source
 * index, the props digests or the control group the run had used, and reported
 * *no rung above holds this* about a component the run had attributed to an
 * edited parent two rungs up.
 *
 * What is asserted here is the round trip and the shape of its absences: a rung
 * that does not apply comes back missing rather than empty, and a list the report
 * meant as *not known* does not come back as *none*.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

function movement(over: Partial<MovementRecord> = {}): MovementRecord {
  return {
    subject: 'story:product-card--sale',
    component: 'CardFooter',
    bands: ['geometry'],
    cause: 'upstream',
    because: '`ProductCard` was edited and reaches it through `Card`',
    upstream: 'ProductCard',
    through: ['Card'],
    alsoIn: [],
    held: [],
    ...over,
  };
}

function composition(movements: readonly MovementRecord[]): CompositionReport {
  return {
    subjects: ['story:product-card--sale', 'story:cart-card--item'],
    components: [
      {
        component: 'CardFooter',
        subjects: ['story:product-card--sale'],
        instances: 1,
        examples: 1,
        within: ['Card'],
        createdBy: [],
        renders: [],
        tokens: [],
        variants: 1,
        renderings: 1,
      },
    ],
    echoes: [],
    divergences: [],
    movements,
  };
}

function report(movements: readonly MovementRecord[]): RunReport {
  return {
    runVersion: 1,
    at: '2026-08-30T10:00:00.000Z',
    identity: IDENTITY,
    retention: 'durable',
    observations: [
      {
        subject: 'story:product-card--sale',
        verdict: 'changed',
        because: 'the rendered image differs from the baseline',
        changedPixels: 974,
        regions: [
          { x: 0, y: 0, width: 10, height: 10, pixels: 974, component: 'CardFooter', cause: true },
        ],
        findings: [],
      },
    ],
    composition: composition(movements),
  };
}

let db: SqliteD1;
let review: ReviewStore;

beforeEach(async () => {
  db = await createSqliteD1();
  review = createReviewStore({
    db,
    bucket: createMemoryR2(),
    project: 'snkr-shop',
    now: () => new Date('2026-08-30T12:00:00.000Z'),
  });
});

async function ingest(movements: readonly MovementRecord[]): Promise<void> {
  await review.ingest({
    build: '9',
    commit: 'a'.repeat(40),
    report: report(movements),
    images: {},
  });
}

describe('what the run concluded survives the ingest', () => {
  it('carries the rung, the sentence and the chain that reaches it', async () => {
    await ingest([movement()]);

    const detail = await review.build('9');

    expect(detail?.movements).toEqual([
      {
        subject: 'story:product-card--sale',
        component: 'CardFooter',
        cause: 'upstream',
        because: '`ProductCard` was edited and reaches it through `Card`',
        bands: ['geometry'],
        held: [],
        upstream: 'ProductCard',
        through: ['Card'],
      },
    ]);
  });

  it('leaves a rung that does not apply off the row rather than empty on it', async () => {
    // `file` belongs to `edited`, `tokens` to `token`, `through` to a chain with
    // something in it. A reader that received `through: []` on a movement whose
    // parent draws it directly would print *reaches it through nothing*.
    await ingest([movement({ upstream: 'ProductCard', through: undefined })]);

    const [only] = (await review.build('9'))?.movements ?? [];

    expect(only?.upstream).toBe('ProductCard');
    expect(only && 'through' in only).toBe(false);
    expect(only && 'file' in only).toBe(false);
    expect(only && 'standing' in only).toBe(false);
  });

  it('keeps a name-only comparison saying *not known* rather than *no band*', async () => {
    await ingest([movement({ bands: [] })]);

    expect((await review.build('9'))?.movements[0]?.bands).toEqual([]);
  });

  it('keeps one component’s two renders apart', async () => {
    // The primary key is the pair. Keyed by component alone, the second row
    // replaces the first and the reviewer is told one render's story twice.
    await ingest([
      movement({ subject: 'story:product-card--sale', cause: 'edited', file: 'ui/footer.tsx' }),
      movement({ subject: 'story:cart-card--item' }),
    ]);

    const found = (await review.build('9'))?.movements ?? [];

    expect(found).toHaveLength(2);
    expect(found.map((each) => each.cause).sort()).toEqual(['edited', 'upstream']);
  });

  it('carries the standing that separates a flake from a shortlist entry', async () => {
    await ingest([
      movement({ cause: 'unexplained', upstream: undefined, through: undefined, standing: 'suspect' }),
    ]);

    expect((await review.build('9'))?.movements[0]?.standing).toBe('suspect');
  });

  it('answers an empty list when the report attributed nothing', async () => {
    await ingest([]);

    const detail = await review.build('9');

    // The census still landed, which is what makes this an absence of movement
    // rather than an absence of composition.
    expect(detail?.movements).toEqual([]);
    expect(detail?.composition).toHaveLength(1);
  });

  it('replaces a re-ingested build rather than accumulating both readings', async () => {
    await ingest([movement()]);
    await ingest([movement({ cause: 'edited', because: 'its own file', upstream: undefined })]);

    const found = (await review.build('9'))?.movements ?? [];

    expect(found).toHaveLength(1);
    expect(found[0]?.cause).toBe('edited');
  });
});
