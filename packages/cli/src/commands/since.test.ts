import { describe, expect, it } from 'vitest';
import type { SourceIndex } from '@variance-authority/core';
import type { Collected, Plan } from './run.js';
import {
  collectorOf,
  configOf,
  documentFor,
  runWith,
  storeAnswering,
  whiteBaselineOf,
} from './run-fixture.js';

/**
 * `--since`: what a run is allowed *not* to look at.
 *
 * The saving this buys is the largest one available — a 300-subject suite where
 * one component moved pays for two verdicts instead of three hundred collections.
 * The risk it carries is the worst one available: a subject skipped in error is a
 * green run over an unwatched surface, and it is silent, because the subject is
 * not in the report to be missing from.
 *
 * So the assertions are about *accounting*. A skipped subject is still in the
 * artifact, with the sentence that skipped it, and a run that could not narrow
 * says which of the two things happened.
 */

const SOURCE: SourceIndex = {
  Button: [{ file: 'src/Button.tsx', line: 1, via: 'function' }],
  Clock: [{ file: 'src/Clock.tsx', line: 1, via: 'const' }],
};

const CONFIG = configOf({ source: { dirs: ['src'] } });

const PLAN: Plan = {
  subjects: [{ subject: { id: 'fixture:a', kind: 'fixture' } }],
  notObserved: [],
  warnings: [],
};

const COLLECTOR = collectorOf(
  PLAN,
  (subject): Collected => ({ ok: true, document: documentFor(subject.subject.id) }),
);

/** Two subjects whose baselines record one component each. */
function stored(components: readonly string[]) {
  const baseline = whiteBaselineOf(documentFor('fixture:a'));
  return storeAnswering({
    ...baseline,
    raster: { ...baseline.raster, components: components.map((component) => ({ component, instances: 1, structure: 'v1:s' })) },
  });
}

describe('narrowing a run to what a diff could have changed', () => {
  it('leaves a subject whose baseline names no component the diff touched unreached', async () => {
    const { report } = await runWith(CONFIG, COLLECTOR, stored(['Clock']), {
      since: { ref: 'origin/main', changed: ['src/Button.tsx'] },
      scanSource: async () => SOURCE,
    });

    // In the artifact, not missing from it, and carrying the reason.
    expect(report.observations).toEqual([]);
    expect(report.notObserved?.[0]?.subject).toBe('fixture:a');
    // `unreached`, not `excluded`. Nobody configured this: the run read the diff
    // against the stored baselines and concluded the change cannot arrive here.
    // Filing it as a decision reports one that was never made, and hides the
    // only reasoning that distinguishes this tool from a suite runner.
    expect(report.notObserved?.[0]?.kind).toBe('unreached');
    expect(report.notObserved?.[0]?.because).toContain('not affected by the diff against origin/main');
  });

  it('observes a subject whose baseline names a component the diff touched', async () => {
    const { report } = await runWith(CONFIG, COLLECTOR, stored(['Button']), {
      since: { ref: 'origin/main', changed: ['src/Button.tsx'] },
      scanSource: async () => SOURCE,
    });

    expect(report.observations.map((entry) => entry.subject)).toEqual(['fixture:a']);
    expect(report.notObserved).toEqual([]);
  });

  it('looks up selection sidecars under the planned viewport identity', async () => {
    const plan: Plan = {
      ...PLAN,
      subjects: [{ ...PLAN.subjects[0]!, viewport: { ...CONFIG.viewport, deviceScaleFactor: 2 } }],
    };
    const collector = collectorOf(plan, (subject): Collected => ({
      ok: true,
      document: documentFor(subject.subject.id),
    }));
    const base = stored(['Clock']);
    let describedScale = 0;
    const store = {
      ...base,
      async describe(key: Parameters<typeof base.describe>[0], identity: Parameters<typeof base.describe>[1]) {
        describedScale = identity.deviceScaleFactor;
        return await base.describe(key, identity);
      },
    };

    await runWith(CONFIG, collector, store, {
      since: { ref: 'origin/main', changed: ['src/Button.tsx'] },
      scanSource: async () => SOURCE,
    });

    expect(describedScale).toBe(2);
  });

  it('says out loud when it declined to narrow', async () => {
    // "We could not rule anything out" and "nothing needed ruling out" produce
    // the same run and mean opposite things about the next one.
    const { report } = await runWith(CONFIG, COLLECTOR, stored(['Clock']), {
      since: { ref: 'origin/main', changed: ['src/tokens.css'] },
      scanSource: async () => SOURCE,
    });

    expect(report.observations.map((entry) => entry.subject)).toEqual(['fixture:a']);
    expect(report.warnings?.join('\n')).toContain('did not narrow this run');
    expect(report.warnings?.join('\n')).toContain('declares no component');
  });

  it('refuses `--since` with no configured source directories', async () => {
    // Narrowing on an empty index would rule out the whole suite and report
    // success. An operator error, raised as one.
    await expect(
      runWith(configOf({}), COLLECTOR, stored(['Clock']), {
        since: { ref: 'origin/main', changed: ['src/Button.tsx'] },
        scanSource: async () => SOURCE,
      }),
    ).rejects.toThrow(/where your components are declared/);
  });

  // Both flags at once, naming two different revisions. `selectionFor` now
  // narrows by `--since` and explains by `--against` — it used to resolve them
  // by precedence and drop the `--against` ref without a word — and nothing here
  // holds it to that, because `--against` needs a relations scanner this fixture
  // does not offer.
  it.todo(
    'narrows by `--since` and explains by `--against` when both name a ref, so the change set the movement ladder reads is the one the operator asked to be explained against — needs `runWith` to accept an `--against` ref and a relations scanner, because that flag refuses without a file graph and these fixtures have nowhere to hand it one',
  );
});
