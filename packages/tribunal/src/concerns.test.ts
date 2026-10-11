// A concern: what a reviewer suspects about a render, kept apart from whether
// its baseline moves. Beside [`review.test.ts`](./review.test.ts), which decides.

import { beforeEach, describe, expect, it } from 'vitest';
import { createConcernStore, type ConcernStore } from './concerns.js';
import type { ReviewStore } from './review.js';
import { ReviewError } from './review.js';
import { POSTED, decideEverything, ingest, openReview } from './__fixtures__/review.js';
import type { SqliteD1 } from './testing.js';

const SUBJECT = 'story:todos--populated';

let db: SqliteD1;
let review: ReviewStore;
let concerns: ConcernStore;
let clock: Date;

beforeEach(async () => {
  clock = new Date(POSTED);
  ({ db, review } = await openReview(() => clock));
  concerns = createConcernStore({ db, project: 'todomvc', now: () => clock });
  await review.ingest(ingest());
});

describe('raising a concern', () => {
  it('records what was suspected, where, and on what evidence', async () => {
    const raised = await concerns.raise({
      build: 'ci-1001',
      subject: SUBJECT,
      title: 'Total moved below the fold',
      note: 'The order total sits under the promo banner now',
      hypothesis: 'The banner gained a margin',
      region: { x: 0, y: 1, width: 2, height: 1, component: 'CartSummary' },
      evidence: ['CartSummary.tsx:84', 'baseline'],
      by: 'marina',
    });

    expect(raised).toEqual({
      id: expect.any(Number),
      build: 'ci-1001',
      subject: SUBJECT,
      title: 'Total moved below the fold',
      region: { x: 0, y: 1, width: 2, height: 1, component: 'CartSummary' },
      evidence: ['CartSummary.tsx:84', 'baseline'],
      by: 'marina',
      at: POSTED,
      state: 'open',
      events: [
        {
          state: 'open',
          by: 'marina',
          at: POSTED,
          note: 'The order total sits under the promo banner now',
          hypothesis: 'The banner gained a margin',
        },
      ],
    });
  });

  it('starts in the state the reviewer chose', async () => {
    const raised = await concerns.raise({
      build: 'ci-1001',
      subject: SUBJECT,
      title: 'Spacing',
      state: 'investigating',
      by: 'marina',
    });
    expect(raised.state).toBe('investigating');
  });

  it('keeps no region and no evidence as absent, not as empty', async () => {
    const raised = await concerns.raise({ build: 'ci-1001', subject: SUBJECT, title: 'Spacing', by: 'marina' });
    expect(raised).not.toHaveProperty('region');
    expect(raised.evidence).toEqual([]);
    expect(raised.events[0]).not.toHaveProperty('note');
  });

  it('refuses a subject the build never reported', async () => {
    await expect(
      concerns.raise({ build: 'ci-1001', subject: 'story:nope', title: 'x', by: 'marina' }),
    ).rejects.toThrow(ReviewError);
  });

  it('leaves nothing behind when its first step could not be written', async () => {
    // A concern with no trail has no state, and the store refuses to read one
    // rather than invent `open`; the triggers refuse to delete it. So a raise is
    // both rows or neither, or one failed write breaks the subject for good.
    const failing = {
      ...db,
      prepare: (sql: string) =>
        sql.includes('INSERT INTO concern_events')
          ? db.prepare('INSERT INTO no_such_table VALUES (1)')
          : db.prepare(sql),
    };
    const broken = createConcernStore({ db: failing, project: 'todomvc', now: () => clock });

    await expect(broken.raise({ build: 'ci-1001', subject: SUBJECT, title: 'Spacing', by: 'marina' })).rejects.toThrow();
    expect(await concerns.list({ subject: SUBJECT })).toEqual([]);
  });

  it('refuses an empty title', async () => {
    await expect(
      concerns.raise({ build: 'ci-1001', subject: SUBJECT, title: '  ', by: 'marina' }),
    ).rejects.toThrow(/title/);
  });

  it('keeps a region with no component as a rectangle alone', async () => {
    const raised = await concerns.raise({
      build: 'ci-1001',
      subject: SUBJECT,
      title: 'Spacing',
      region: { x: 0, y: 1, width: 2, height: 1 },
      by: 'marina',
    });
    expect(raised.region).toEqual({ x: 0, y: 1, width: 2, height: 1 });
  });

  it('refuses a region whose component names nothing', async () => {
    for (const component of ['', 42]) {
      await expect(
        concerns.raise({
          build: 'ci-1001',
          subject: SUBJECT,
          title: 'x',
          region: { x: 0, y: 0, width: 4, height: 4, component } as never,
          by: 'marina',
        }),
      ).rejects.toThrow(/component/);
    }
  });

  it('refuses a region with no area', async () => {
    await expect(
      concerns.raise({
        build: 'ci-1001',
        subject: SUBJECT,
        title: 'x',
        region: { x: 0, y: 0, width: 0, height: 4 },
        by: 'marina',
      }),
    ).rejects.toThrow(/region/);
  });
});

describe('moving a concern', () => {
  it('appends each step, so the trail says who moved it and why', async () => {
    const raised = await concerns.raise({ build: 'ci-1001', subject: SUBJECT, title: 'Spacing', by: 'marina' });
    clock = new Date(Date.parse(POSTED) + 60_000);
    await concerns.move(raised.id, { state: 'investigating', by: 'anton', hypothesis: 'Token drift' });
    clock = new Date(Date.parse(POSTED) + 120_000);
    const resolved = await concerns.move(raised.id, { state: 'resolved', by: 'anton', note: 'Intended' });

    expect(resolved.state).toBe('resolved');
    expect(resolved.events.map((event) => [event.state, event.by])).toEqual([
      ['open', 'marina'],
      ['investigating', 'anton'],
      ['resolved', 'anton'],
    ]);
  });

  it('keeps a note added without a state change', async () => {
    const raised = await concerns.raise({ build: 'ci-1001', subject: SUBJECT, title: 'Spacing', by: 'marina' });
    const noted = await concerns.move(raised.id, { state: 'open', by: 'anton', note: 'Seen on mobile too' });
    expect(noted.events).toHaveLength(2);
    expect(noted.state).toBe('open');
  });

  it('refuses a concern this project never raised', async () => {
    await expect(concerns.move(999, { state: 'resolved', by: 'marina' })).rejects.toThrow(ReviewError);
  });

  it('refuses a step nobody can read back', async () => {
    const raised = await concerns.raise({ build: 'ci-1001', subject: SUBJECT, title: 'Spacing', by: 'marina' });
    await expect(
      concerns.move(raised.id, { state: 'closed' as never, by: 'marina' }),
    ).rejects.toThrow(/state/);
  });
});

describe('reading concerns', () => {
  it('answers by subject and by state', async () => {
    const one = await concerns.raise({ build: 'ci-1001', subject: SUBJECT, title: 'One', by: 'marina' });
    await concerns.raise({ build: 'ci-1001', subject: SUBJECT, title: 'Two', by: 'marina' });
    await concerns.move(one.id, { state: 'resolved', by: 'marina' });

    expect((await concerns.list({ subject: SUBJECT })).map((c) => c.title)).toEqual(['One', 'Two']);
    expect((await concerns.list({ state: 'open' })).map((c) => c.title)).toEqual(['Two']);
    expect(await concerns.list({ subject: 'story:other' })).toEqual([]);
  });

  it('follows the subject into later builds', async () => {
    // A concern is about a render, not about one upload of it. The next build of
    // the same subject is where somebody checks whether it still holds.
    await concerns.raise({ build: 'ci-1001', subject: SUBJECT, title: 'Spacing', by: 'marina' });
    await review.ingest(ingest({ build: 'ci-1002' }));

    expect((await concerns.list({ seenIn: 'ci-1002' })).map((c) => c.build)).toEqual(['ci-1001']);
    expect(await concerns.list({ seenIn: 'ci-9999' })).toEqual([]);
  });

  it('survives an approval of the same subject', async () => {
    // Accepting a baseline answers whether the pixels move. It does not answer
    // whether the suspicion was right, and erasing one with the other is how a
    // concern disappears on the click that was meant to defer it.
    await concerns.raise({ build: 'ci-1001', subject: SUBJECT, title: 'Spacing', by: 'marina' });
    await review.decide({ build: 'ci-1001', subject: SUBJECT, decision: 'approved', by: 'marina' });

    expect((await concerns.list({ subject: SUBJECT }))[0]?.state).toBe('open');
  });

  it('outlives the sweep that removes the build it was raised in', async () => {
    await concerns.raise({ build: 'ci-1001', subject: SUBJECT, title: 'Spacing', by: 'marina' });
    await decideEverything(review);

    clock = new Date('2027-06-01T12:00:00.000Z');
    expect((await review.sweep(30)).builds).toBe(1);
    expect((await concerns.list({ subject: SUBJECT })).map((c) => c.title)).toEqual(['Spacing']);
  });

  it('cannot be rewritten or deleted under the store', async () => {
    await concerns.raise({ build: 'ci-1001', subject: SUBJECT, title: 'Spacing', by: 'marina' });
    await expect(db.prepare(`UPDATE concerns SET title = 'other'`).bind().run()).rejects.toThrow(/append-only/);
    await expect(db.prepare('DELETE FROM concern_events').bind().run()).rejects.toThrow(/append-only/);
  });

  it('counts the open, investigating and resolved concerns on what a build showed', async () => {
    const one = await concerns.raise({ build: 'ci-1001', subject: SUBJECT, title: 'One', by: 'marina' });
    await concerns.raise({ build: 'ci-1001', subject: SUBJECT, title: 'Two', by: 'marina' });
    await concerns.move(one.id, { state: 'investigating', by: 'marina' });

    expect(await concerns.tally('ci-1001')).toEqual({ open: 1, investigating: 1, resolved: 0 });
  });
});
