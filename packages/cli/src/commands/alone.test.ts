import { describe, expect, it } from 'vitest';
import type { RenderDocument } from '@variance-authority/core/format';
import type { Found } from '@variance-authority/raster';
import type { Collector, Plan } from './run.js';
import {
  collectorOf,
  configOf,
  documentFor,
  painter,
  runWith,
  storeAnswering,
  whiteBaselineOf,
} from './run-fixture.js';

/**
 * The corner-cut this whole project is built on is that the world is not rebuilt
 * between subjects, and the risk it buys is that subject B renders differently
 * because subject A ran first. A comparison cannot tell that apart from a
 * regression: both arrive as "the pixels moved".
 *
 * Every case here is the *deterministic* leak, and that is the point. The
 * detection `@variance-authority/session` already implements re-runs a subject
 * in the same session and compares hashes, which varies time and holds the world
 * fixed — so a leak that happens every time never moves the hash and is reported
 * as nothing at all. These subjects would pass that check and still be wrong.
 */
describe('a change that does not survive a clean world', () => {
  /**
   * `dark` is what a leaked stylesheet did to this subject; `plain` is the truth.
   *
   * Carried in the html rather than in a hash field, because `documentDigest`
   * covers the document's own inputs and not the snapshot's derived hashes — a
   * marker the digest cannot see settles against the baseline and never reaches
   * a comparison at all.
   */
  function documentPainted(id: string, paint: 'plain' | 'dark'): RenderDocument {
    return documentFor(id, `<div data-va-path="0" data-paint="${paint}">x</div>`);
  }

  /** The baseline: this subject, painted from a document nothing had polluted. */
  function baselineOf(id: string): Found {
    return whiteBaselineOf(documentPainted(id, 'plain'));
  }

  /**
   * A collector whose shared world is poisoned and whose clean world is not.
   *
   * `collect` returns the same polluted document every time it is asked, which is
   * exactly the failure a same-session re-run cannot see.
   */
  function leaking(
    ids: readonly string[],
    options: { alone?: 'plain' | 'dark'; shared?: 'plain' | 'dark' } = {},
  ): Collector & { aloneCalls: string[] } {
    const aloneCalls: string[] = [];
    const plan: Plan = {
      subjects: ids.map((id) => ({ subject: { id, kind: 'fixture' as const } })),
      notObserved: [],
      warnings: [],
    };

    return {
      aloneCalls,
      async plan() {
        return plan;
      },
      async collect(subject) {
        return { ok: true, document: documentPainted(subject.subject.id, options.shared ?? 'dark') };
      },
      async collectAlone(subject) {
        aloneCalls.push(subject.subject.id);
        return { ok: true, document: documentPainted(subject.subject.id, options.alone ?? 'plain') };
      },
      async close() {
        /* nothing to release */
      },
    };
  }

  it('calls it order dependence when the difference is gone with nothing else in the world', async () => {
    const collector = leaking(['fixture:a']);
    const { report } = await runWith(configOf(), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    const [observation] = report.observations;
    // The verdict stays `changed`, and that is deliberate: the pixels really did
    // move. What the second pass adds is *why*, and the two need opposite work.
    expect(observation?.verdict).toBe('changed');
    expect(observation?.alone?.reproduced).toBe(false);
    expect(observation?.alone?.because).toContain('matches its baseline when run alone');
    expect(collector.aloneCalls).toEqual(['fixture:a']);
  });

  it('leaves a real change standing, because it is still there alone', async () => {
    // Same shape, one difference: the clean world shows the change too. Nothing
    // here may soften a regression — a second render that can only clear a
    // failure is a retry, and this is not one.
    const collector = leaking(['fixture:a'], { alone: 'dark' });
    const { report } = await runWith(configOf(), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    expect(report.observations[0]?.verdict).toBe('changed');
    expect(report.observations[0]?.alone?.reproduced).toBe(true);
    expect(report.observations[0]?.alone?.because).toContain('still there');
  });

  it('never re-collects a subject that did not change, so a green run pays nothing', async () => {
    const collector = leaking(['fixture:a'], { shared: 'plain' });
    const { report } = await runWith(configOf(), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    expect(report.observations[0]?.verdict).toBe('unchanged');
    expect(report.observations[0]?.alone).toBeUndefined();
    expect(collector.aloneCalls).toEqual([]);
  });

  it('says the collector has no clean world, rather than reading silence as clean', async () => {
    // A collector holding one page open across the whole run cannot produce one,
    // and the absent capability has to arrive as a sentence. Read as "it
    // reproduces", a missing method promotes every leak with a confirmation
    // attached to it.
    const collector = collectorOf(
      { subjects: [{ subject: { id: 'fixture:a', kind: 'fixture' } }], notObserved: [], warnings: [] },
      (subject) => ({ ok: true, document: documentPainted(subject.subject.id, 'dark') }),
    );

    const { report } = await runWith(configOf(), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    expect(report.observations[0]?.alone?.reproduced).toBe(true);
    expect(report.observations[0]?.alone?.because).toContain('no `collectAlone`');
  });

  it('stops at the budget and says so, so a token change cannot buy full isolation', async () => {
    // The one case where this pass costs more than the isolation it replaces:
    // everything changed, so everything would be re-collected. The cap is the
    // answer, and a cap that is not reported reads as coverage.
    const collector = leaking(['fixture:a', 'fixture:b', 'fixture:c']);
    const store = storeAnswering(baselineOf('fixture:a'));

    const { report } = await runWith(configOf({ alone: { limit: 2 } }), collector, store, {
      renderer: painter(),
    });

    // Spent across the run rather than per subject: two re-collections, not three.
    expect(collector.aloneCalls).toEqual(['fixture:a', 'fixture:b']);
    expect(report.observations[2]?.alone?.reproduced).toBe(true);
    expect(report.observations[2]?.alone?.because).toContain('budget of 2 subjects spent');
  });

  it('turns the pass off at zero without claiming anything about the change', async () => {
    // `limit: 0` is a decision and an absent `collectAlone` is a missing
    // capability. Both skip the work; only one of them is worth a sentence about
    // the collector, so the operator who chose this is not told to write a method
    // they already wrote.
    const collector = leaking(['fixture:a']);
    const { report } = await runWith(configOf({ alone: { limit: 0 } }), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    expect(report.observations[0]?.verdict).toBe('changed');
    expect(report.observations[0]?.alone).toBeUndefined();
    expect(collector.aloneCalls).toEqual([]);
  });
});
