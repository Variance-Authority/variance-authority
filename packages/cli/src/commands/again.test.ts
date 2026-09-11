import { describe, expect, it } from 'vitest';
import type { SourceIndex } from '@variance-authority/core/attribute';
import {
  environmentKey,
  profileById,
  type RenderDocument,
  type SemanticSnapshot,
} from '@variance-authority/core/format';
import type { Found } from '@variance-authority/raster';
import { EXIT_CLEAN, EXIT_REVIEW, exitFor } from '../exit.js';
import type { Collected, Collector, Plan } from './run.js';
import {
  VIEWPORT,
  configOf,
  documentFor,
  painter,
  runWith,
  storeAnswering,
  whiteBaselineOf,
} from './run-fixture.js';

/**
 * A subject read twice, in one world, with nothing changed in between.
 *
 * The experiment `alone` cannot run. That one rebuilds the world and holds time,
 * which finds a leak and is blind to a clock; this one holds the world and lets
 * time pass, which finds the clock and is blind to a leak that fires every run.
 * Both are needed, and the ordering is the load-bearing part: `alone` infers
 * *the clean reading differs, therefore the world moved it*, and that inference is
 * only available on a subject whose two readings would otherwise have agreed.
 *
 * So every test below is also a test that the run does not reach a confident
 * conclusion about the suite from evidence that cannot support one.
 */
describe('a subject that does not read the same way twice', () => {
  /**
   * A reading of a page with a clock in it.
   *
   * `dark` is what makes it differ from the white baseline — the run has to call
   * it `changed` before any of this is reached at all — and `at` is what moves
   * between two readings taken seconds apart.
   */
  function reading(id: string, at: string): RenderDocument {
    return documentFor(
      id,
      `<div data-va-path="0" data-paint="dark"><span data-va-path="0/0">${at}</span></div>`,
    );
  }

  /** The same reading as a snapshot, so the disagreement can be named. */
  function snapshotOf(id: string, at: string): SemanticSnapshot {
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
      root: {
        path: '0',
        tag: 'div',
        attributes: {},
        style: {},
        provenance: { owners: [{ name: 'Clock', propsDigest: 'v1:x' }] },
        children: [
          {
            path: '0/0',
            tag: 'span',
            attributes: {},
            style: {},
            text: at,
            provenance: { owners: [{ name: 'Clock', propsDigest: 'v1:x' }] },
            children: [],
          },
        ],
      },
      styleProvenance: [],
      diagnostics: [],
    };
  }

  /**
   * The baseline: a plain document, painted white.
   *
   * Deliberately not one of the readings. A baseline equal to the first reading
   * settles on its digest and never reaches a comparison at all, so every test
   * here would pass by never running the code it is about.
   */
  function baselineOf(id: string): Found {
    return whiteBaselineOf(documentFor(id));
  }

  /**
   * A collector whose subject reads a different time on every call.
   *
   * `collectAlone` returns the *same* document as the shared world does — so if
   * anything here reported order dependence it would be reporting it about a
   * collector that has no leak at all, which is the false conclusion this whole
   * ordering exists to prevent.
   */
  function ticking(
    ids: readonly string[],
    options: {
      readonly frozen?: boolean;
      readonly snapshots?: boolean;
      readonly source?: SourceIndex;
    } = {},
  ): Collector & { collectCalls: string[]; aloneCalls: string[] } {
    const collectCalls: string[] = [];
    const aloneCalls: string[] = [];
    let tick = 0;

    const plan: Plan = {
      subjects: ids.map((id) => ({ subject: { id, kind: 'fixture' as const } })),
      notObserved: [],
      warnings: [],
    };

    const read = (id: string): Collected => {
      const at = options.frozen === true ? '12:00' : `12:0${tick}`;
      tick += 1;
      return {
        ok: true,
        document: reading(id, at),
        ...(options.snapshots === true ? { snapshot: snapshotOf(id, at) } : {}),
        ...(options.source !== undefined ? { source: options.source } : {}),
      };
    };

    return {
      collectCalls,
      aloneCalls,
      async plan() {
        return plan;
      },
      async collect(subject) {
        collectCalls.push(subject.subject.id);
        return read(subject.subject.id);
      },
      async collectAlone(subject) {
        aloneCalls.push(subject.subject.id);
        return read(subject.subject.id);
      },
      async close() {
        /* nothing to release */
      },
    };
  }

  it('reports it as unstable rather than as a change, and never asks the clean world', async () => {
    const collector = ticking(['fixture:a']);
    const { report } = await runWith(configOf(), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    const [observation] = report.observations;
    // The verdict stays `changed` — those pixels really did move — for the same
    // reason order dependence leaves it standing. What is added is that the
    // verdict was decided by whichever of two disagreeing readings came first.
    expect(observation?.verdict).toBe('changed');
    expect(observation?.unstable?.because).toContain('the two readings disagree');

    // The whole ordering argument, as an assertion. A clean-world answer here
    // would compare two readings that do not agree in *any* world, and would have
    // reported "the change is still there, so it is the component" — a sentence
    // about a component nobody edited, aimed at a bisection that never converges.
    expect(collector.aloneCalls).toEqual([]);
    expect(observation?.alone).toBeUndefined();
  });

  it('names the component and the band, which is what makes the fix bounded', async () => {
    const collector = ticking(['fixture:a'], { snapshots: true });
    const { report } = await runWith(configOf(), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    // "This subject is flaky" is a page to read. `Clock (content)` is a node whose
    // text moves between two readings seconds apart, and the causes of that are a
    // short list — a clock, a seed, a counter, a request that had not landed.
    expect(report.observations[0]?.unstable?.components).toEqual([{ name: 'Clock' }]);
    expect(report.observations[0]?.unstable?.bands).toEqual(['content']);
    expect(report.observations[0]?.unstable?.because).toContain('Clock read differently (content)');
  });

  it('resolves the component to the file an editor opens, when the collector knows one', async () => {
    // The last step of the same handoff every other answer here makes. A name
    // sends a reader to a search; `src/ds/Clock.tsx:22` sends them to the line,
    // and the index that answers it is already in the collector's hands.
    const collector = ticking(['fixture:a'], {
      snapshots: true,
      source: { Clock: [{ file: 'src/ds/Clock.tsx', line: 22 }] },
    });
    const { report } = await runWith(configOf(), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    expect(report.observations[0]?.unstable?.components).toEqual([
      { name: 'Clock', file: 'src/ds/Clock.tsx:22' },
    ]);
    expect(report.observations[0]?.unstable?.because).toContain('Clock src/ds/Clock.tsx:22');
  });

  it('says nothing could name it, rather than naming nothing, with no snapshot', async () => {
    // An empty component list has two possible meanings — no component was
    // responsible, or nothing was able to look — and they send a reader to
    // opposite places. The list is empty either way, so the sentence carries it.
    const collector = ticking(['fixture:a']);
    const { report } = await runWith(configOf(), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    expect(report.observations[0]?.unstable?.components).toEqual([]);
    expect(report.observations[0]?.unstable?.because).toContain('no snapshot was collected');
  });

  it('leaves a stable subject to the clean-world pass, which still runs', async () => {
    // The counterweight. A subject that reads the same way twice has passed this
    // check and nothing about it is softened: `alone` runs exactly as before, and
    // a second reading that agreed must never turn into a reason not to look.
    const collector = ticking(['fixture:a'], { frozen: true });
    const { report } = await runWith(configOf(), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    expect(report.observations[0]?.verdict).toBe('changed');
    expect(report.observations[0]?.unstable).toBeUndefined();
    expect(collector.aloneCalls).toEqual(['fixture:a']);
  });

  it('never re-reads a subject that did not change, so a green run pays nothing', async () => {
    // The economy this shares with the clean-world pass, and the reason it can be
    // on by default: it costs one collection on subjects somebody was going to
    // have to review anyway, and nothing at all on the other 298.
    const collector = ticking(['fixture:a'], { frozen: true });
    const store = storeAnswering(baselineOf('fixture:a'));

    // The same plain document the baseline was painted from, so the run settles.
    const quiet = { ...collector, async collect(subject: { subject: { id: string } }) {
      collector.collectCalls.push(subject.subject.id);
      return { ok: true as const, document: documentFor(subject.subject.id) };
    } };

    const { report } = await runWith(configOf(), quiet as Collector, store, {
      renderer: painter(),
    });

    expect(report.observations[0]?.verdict).toBe('unchanged');
    expect(collector.collectCalls).toEqual(['fixture:a']);
  });

  it('treats a second collection that fails as the loudest form of yes', async () => {
    // A collector that produced this subject and then could not produce it again,
    // seconds later, with nothing changed, has already answered the question. It
    // is not a coverage hole either — the subject *was* observed, once.
    let calls = 0;
    const collector: Collector = {
      async plan() {
        return {
          subjects: [{ subject: { id: 'fixture:a', kind: 'fixture' as const } }],
          notObserved: [],
          warnings: [],
        };
      },
      async collect(subject) {
        calls += 1;
        if (calls > 1) return { ok: false, because: 'the story stopped mounting' };
        return { ok: true, document: reading(subject.subject.id, '12:00') };
      },
      async close() {
        /* nothing to release */
      },
    };

    const { report } = await runWith(configOf(), collector, storeAnswering(baselineOf('fixture:a')), {
      renderer: painter(),
    });

    expect(report.observations[0]?.unstable?.because).toContain('the story stopped mounting');
    expect(report.observations[0]?.unstable?.because).toContain('cannot be taken twice');
    // Observed, not skipped: a subject with a verdict does not also become a hole
    // in the coverage list, which is what would happen if this threw.
    expect(report.notObserved).toEqual([]);
  });

  it('spends the same budget the clean-world pass does, once per subject', async () => {
    // Two passes, one cap. A subject investigated by either has spent one, so
    // `alone.limit` keeps meaning "changed subjects this run will investigate"
    // rather than doubling silently now that there are two ways to investigate.
    const collector = ticking(['fixture:a', 'fixture:b', 'fixture:c']);
    const { report } = await runWith(
      configOf({ alone: { limit: 2 } }),
      collector,
      storeAnswering(baselineOf('fixture:a')),
      { renderer: painter() },
    );

    expect(report.observations[0]?.unstable).toBeDefined();
    expect(report.observations[1]?.unstable).toBeDefined();
    expect(report.observations[2]?.unstable).toBeUndefined();
  });

  it('finds a subject that agrees with its baseline and not with itself, under --flakes', async () => {
    // The whole point of the sweep, and it is unreachable from a verdict. This
    // subject settles on its digest — the run never builds an `Observation` for
    // it at all — and it would have flaked on the next commit that touched
    // anything near it. One run earlier, for one collection.
    const collector = ticking(['fixture:a'], { snapshots: true });
    const store = storeAnswering(whiteBaselineOf(reading('fixture:a', '12:00')));

    const { report } = await runWith(configOf(), collector, store, {
      renderer: painter(),
      flakes: true,
    });

    expect(report.observations[0]?.verdict).toBe('unchanged');
    expect(report.observations[0]?.unstable?.components).toEqual([{ name: 'Clock' }]);
    // Not the changed-subject sentence: nothing here is unconfirmed, and telling
    // an operator their difference is uncleared when there was no difference
    // would send them looking for one.
    expect(report.observations[0]?.unstable?.because).toContain('verdict of `unchanged`');
    expect(exitFor(report)).toBe(EXIT_REVIEW);
  });

  it('sweeps the whole suite rather than the first `alone.limit` of it', async () => {
    // A budget exists to cap how much of a red build's investigation is worth
    // paying for. A sweep is not that, and an operator who asked about the suite
    // and got the first two subjects under a whole-suite heading would have been
    // handed a partial answer that looks complete.
    const collector = ticking(['fixture:a', 'fixture:b', 'fixture:c'], { snapshots: true });

    const { report } = await runWith(
      configOf({ alone: { limit: 2 } }),
      collector,
      storeAnswering(baselineOf('fixture:a')),
      { renderer: painter(), flakes: true },
    );

    expect(report.observations.map((o) => o.unstable !== undefined)).toEqual([true, true, true]);
  });

  it('is still off at zero, which is the one number that means do not re-collect', async () => {
    // `limit: 0` and `--flakes` contradict each other, and the config wins. One
    // number cannot mean "do not re-collect anything" on Tuesday and "except when
    // asked nicely" on Wednesday.
    const collector = ticking(['fixture:a'], { snapshots: true });

    const { report } = await runWith(
      configOf({ alone: { limit: 0 } }),
      collector,
      storeAnswering(baselineOf('fixture:a')),
      { renderer: painter(), flakes: true },
    );

    expect(report.observations[0]?.unstable).toBeUndefined();
  });

  it('does not demand stability in a band the subject says it does not assert on', async () => {
    // The boundary, and without it this whole check would undo route-level VR. A
    // route declared `layout` has said in the config that it does not assert on
    // what the page is painted with; a clock ticking inside it is then a fact
    // about the page, not a defect in it. Reporting it would make every route
    // test red for exactly the reason its level was written.
    const collector = ticking(['route/home'], { snapshots: true });
    const config = configOf({
      sensitivity: [
        {
          id: 'routes',
          reason: 'a route asserts the page assembles, not what it is painted',
          level: 'layout',
          subjects: ['route/*'],
        },
      ],
    });

    // A baseline the first reading settles against, so the *only* thing in
    // question is the instability. A `changed` verdict would exit 1 on its own
    // and the assertion below would pass without the boundary existing.
    const store = storeAnswering(whiteBaselineOf(reading('route/home', '12:00')));

    const { report } = await runWith(config, collector, store, {
      renderer: painter(),
      flakes: true,
    });

    expect(report.observations[0]?.verdict).toBe('unchanged');

    // Recorded, not dropped — the same rule `ignored` follows for pixels, one
    // level up and about kinds. A suite has to stay answerable about how much of
    // its green came from a declaration.
    expect(report.observations[0]?.unstable?.absorbed).toEqual({ rule: 'routes', level: 'layout' });
    expect(report.observations[0]?.unstable?.bands).toEqual(['content']);
    expect(report.observations[0]?.unstable?.because).toContain('not asserted on');
    expect(exitFor(report)).toBe(EXIT_CLEAN);
  });

  it('still demands it in a band the subject does assert on', async () => {
    // The counterweight. `strict` is a real answer and is how the exception
    // inside a relaxed group is spelled — a declaration that absorbed everything
    // whatever it said would not be a boundary, it would be an off switch.
    const collector = ticking(['route/checkout'], { snapshots: true });
    const config = configOf({
      sensitivity: [
        {
          id: 'checkout-is-strict',
          reason: 'the one page where what it says is the product',
          level: 'strict',
          subjects: ['route/*'],
        },
      ],
    });

    const store = storeAnswering(whiteBaselineOf(reading('route/checkout', '12:00')));

    const { report } = await runWith(config, collector, store, {
      renderer: painter(),
      flakes: true,
    });

    expect(report.observations[0]?.verdict).toBe('unchanged');

    expect(report.observations[0]?.unstable?.absorbed).toBeUndefined();
    expect(exitFor(report)).toBe(EXIT_REVIEW);
  });

  it('turns off at zero, in the same breath as the clean-world pass', async () => {
    const collector = ticking(['fixture:a']);
    const { report } = await runWith(
      configOf({ alone: { limit: 0 } }),
      collector,
      storeAnswering(baselineOf('fixture:a')),
      { renderer: painter() },
    );

    expect(report.observations[0]?.verdict).toBe('changed');
    expect(report.observations[0]?.unstable).toBeUndefined();
    expect(collector.collectCalls).toEqual(['fixture:a']);
  });
});
