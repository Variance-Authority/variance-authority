import { describe, expect, it } from 'vitest';
import type { SourceIndex } from '@variance-authority/core/attribute';
import { relationsOfFiles } from '@variance-authority/core/relate';
import type { Collected, Plan } from './run.js';
import { narrowingFor } from './since.js';
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
  it('resolves an unnarrowed request without inventing either ref', async () => {
    const narrowing = await narrowingFor({ relations: false }, []);

    expect(narrowing.since).toBeUndefined();
    expect(narrowing.against).toBeUndefined();
  });

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

  // The store is asked what it holds against the *plan*, never against what a
  // narrowed run observed. Asked against the observed set, a run that correctly
  // skipped two hundred subjects would report two hundred abandoned baselines —
  // the saving described as damage, on every selective run.
  it('asks the store about the whole plan even when it observed none of it', async () => {
    const asked: string[] = [];
    const store = stored(['Clock']);
    const { report } = await runWith(
      CONFIG,
      COLLECTOR,
      {
        ...store,
        async unplanned(keys) {
          asked.push(...keys.map((key) => key.subject));
          return [];
        },
      },
      {
        since: { ref: 'origin/main', changed: ['src/Button.tsx'] },
        scanSource: async () => SOURCE,
      },
    );

    expect(report.observations).toEqual([]);
    expect(asked).toEqual(['fixture:a']);
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

  /**
   * The second ground. The structural one answers *this subject contains
   * `Button`* about both of these, because it is true of both — and the last run
   * recorded only one of them ever entering the lines this diff changed.
   */
  describe('and what the last run recorded as covered', () => {
    const TWO: Plan = {
      ...PLAN,
      subjects: [
        { subject: { id: 'fixture:a', kind: 'fixture' } },
        { subject: { id: 'fixture:b', kind: 'fixture' } },
      ],
    };

    const BOTH = collectorOf(TWO, (subject): Collected => ({
      ok: true,
      document: documentFor(subject.subject.id),
    }));

    const DIFF = ['--- a/src/Button.tsx', '+++ b/src/Button.tsx', '@@ -9,1 +9,1 @@'].join('\n');

    it('rules out a subject the diff reaches and the journal says it never entered', async () => {
      const { report } = await runWith(CONFIG, BOTH, stored(['Button']), {
        since: { ref: 'origin/main', changed: ['src/Button.tsx'], diff: DIFF },
        scanSource: async () => SOURCE,
        readJourney: async () => ({
          whole: ['fixture:a', 'fixture:b'],
          entered: ['fixture:a'],
          unread: [],
          because: [],
        }),
      });

      expect(report.observations.map((entry) => entry.subject)).toEqual(['fixture:a']);
      expect(report.notObserved?.[0]?.subject).toBe('fixture:b');
      expect(report.notObserved?.[0]?.kind).toBe('unreached');
      expect(report.notObserved?.[0]?.because).toContain('every region it covered');
    });

    it('keeps a subject the diff ruled out when the last run recorded it entering the changed lines', async () => {
      // The structural ground walks only the imports it could read. A chain
      // through one it could not — a computed specifier, a file that did not
      // parse — leaves a subject unreached on the graph, and the recording is the
      // only party holding the answer. It keeps `fixture:a`; it has no say over
      // `fixture:b`, which it never saw enter the change.
      const { report } = await runWith(CONFIG, BOTH, stored(['Clock']), {
        since: { ref: 'origin/main', changed: ['src/Button.tsx'], diff: DIFF },
        scanSource: async () => SOURCE,
        readJourney: async () => ({
          whole: ['fixture:a', 'fixture:b'],
          entered: ['fixture:a'],
          unread: [],
          stale: [],
          because: [],
        }),
      });

      expect(report.observations.map((entry) => entry.subject)).toEqual(['fixture:a']);
      expect(report.notObserved?.map((entry) => [entry.subject, entry.because])).toEqual([
        ['fixture:b', expect.stringContaining('this diff touched none of them')],
      ]);
      const warnings = report.warnings?.join('\n') ?? '';
      expect(warnings).toContain(
        'kept 1 subject the diff ruled out: the last run recorded it entering the changed lines (fixture:a)',
      );
      expect(warnings).toContain('ruled out 1 subject: 1 by what the diff declares and reaches, 0 by');
      expect(warnings).not.toContain('ruled out every subject');
    });

    it('narrows past a changed file the journal records nothing about, and names it', async () => {
      // `unread` is a report. The journal answered for the file it measured, and
      // the one it records nothing about is printed beside the answer rather than
      // turned into a reason to observe every subject. It lies outside
      // `source.dirs`, so no graph the scan could build would hold it either.
      let scanned = false;
      const { report } = await runWith(CONFIG, BOTH, stored(['Button']), {
        since: { ref: 'origin/main', changed: ['src/Button.tsx', 'docs/button.md'], diff: DIFF },
        scanSource: async () => SOURCE,
        scanRelations: async () => {
          scanned = true;
          return relationsOfFiles([]);
        },
        readJourney: async () => ({
          whole: ['fixture:a', 'fixture:b'],
          entered: ['fixture:a'],
          unread: ['docs/button.md'],
          stale: [],
          because: [],
        }),
      });

      expect(report.observations.map((entry) => entry.subject)).toEqual(['fixture:a']);
      expect(report.warnings?.join('\n')).toContain('records nothing about 1 changed file (docs/button.md)');
      expect(report.warnings?.join('\n')).not.toContain('was not narrowed by execution');
      expect(scanned).toBe(false);
    });

    it('asks the graph about a file the journal records nothing about, with no graph configured', async () => {
      // A stylesheet no probe can sit in. The structural ground cannot place it
      // without a graph and keeps both subjects; a journal read without one
      // would hold nothing about it and rule both out.
      const css = ['--- a/src/button.css', '+++ b/src/button.css', '@@ -1,1 +1,1 @@'].join('\n');
      const asked: boolean[] = [];

      const { report } = await runWith(CONFIG, BOTH, stored(['Button']), {
        since: { ref: 'origin/main', changed: ['src/button.css'], diff: css },
        scanSource: async () => SOURCE,
        scanRelations: async () => relationsOfFiles([]),
        readJourney: async (_diff, relations) => {
          asked.push(relations !== undefined);
          return relations === undefined
            ? { whole: ['fixture:a', 'fixture:b'], entered: [], unread: ['src/button.css'], stale: [], because: [] }
            : { whole: ['fixture:a', 'fixture:b'], entered: ['fixture:a'], unread: [], stale: [], because: [] };
        },
      });

      expect(asked).toEqual([false, true]);
      expect(report.observations.map((entry) => entry.subject)).toEqual(['fixture:a']);
    });

    it('observes the subjects that entered an importer of a package the lockfile bumped', async () => {
      // The diff moved the lockfile and no line of source, so a journal read over
      // the hunks alone reaches nobody. The bumped name is answered by the
      // measured modules that import it, which needs the graph from the start.
      const lock = ['--- a/yarn.lock', '+++ b/yarn.lock', '@@ -1,1 +1,1 @@'].join('\n');
      const asked: Array<readonly string[] | undefined> = [];

      const { report } = await runWith(CONFIG, BOTH, stored(['Button']), {
        since: {
          ref: 'origin/main',
          changed: ['yarn.lock'],
          install: { packages: ['left-pad'], manifests: ['yarn.lock', 'package.json'], moved: [] },
          diff: lock,
        },
        scanSource: async () => SOURCE,
        scanRelations: async () => relationsOfFiles([]),
        readJourney: async (_diff, relations, packages) => {
          asked.push(relations === undefined ? undefined : packages);
          const answered = relations !== undefined && packages?.includes('left-pad') === true;
          return {
            whole: ['fixture:a', 'fixture:b'],
            entered: answered ? ['fixture:a'] : [],
            unread: ['yarn.lock'],
            stale: [],
            because: [],
          };
        },
      });

      expect(asked).toEqual([['left-pad']]);
      expect(report.observations.map((entry) => entry.subject)).toEqual(['fixture:a']);
      // The comparison answered the lockfile, so the journal's silence about it
      // is not news.
      expect(report.warnings?.join('\n')).not.toContain('records nothing about');
    });

    it('reads every file of a package whose manifest moved as changed whole', async () => {
      // The lockfile did not move and the diff has one hunk, in a `package.json`
      // whose `exports` now name another file. The journal holds no row for a
      // manifest, so it is handed the package's files instead, each named with
      // no hunk, which is every region of each.
      const manifest = ['--- a/packages/ds/package.json', '+++ b/packages/ds/package.json', '@@ -1,1 +1,1 @@'].join('\n');
      const asked: string[] = [];

      const { report } = await runWith(CONFIG, BOTH, stored(['Button']), {
        since: {
          ref: 'origin/main',
          changed: ['packages/ds/package.json'],
          install: { packages: [], manifests: ['yarn.lock', 'package.json'], moved: ['packages/ds/package.json'] },
          diff: manifest,
        },
        scanSource: async () => SOURCE,
        scanRelations: async () => relationsOfFiles([{ file: 'packages/ds/src/index.ts' }, { file: 'src/Button.tsx' }]),
        readJourney: async (diff, relations) => {
          asked.push(relations === undefined ? 'no graph' : diff);
          const answered = diff.includes('diff --git a/packages/ds/src/index.ts b/packages/ds/src/index.ts');
          return {
            whole: ['fixture:a', 'fixture:b'],
            entered: answered ? ['fixture:a'] : [],
            unread: ['packages/ds/package.json'],
            stale: [],
            because: [],
          };
        },
      });

      expect(asked).toHaveLength(1);
      expect(asked[0]).not.toContain('src/Button.tsx');
      expect(report.observations.map((entry) => entry.subject)).toEqual(['fixture:a']);
      expect(report.warnings?.join('\n')).not.toContain('records nothing about');
    });

    it('observes every subject when the install could not be compared, journal or not', async () => {
      let asked = false;

      const { report } = await runWith(CONFIG, BOTH, stored(['Button']), {
        since: {
          ref: 'origin/main',
          changed: ['src/Button.tsx'],
          install: { whole: 'yarn.lock changed and this could not read it' },
          diff: DIFF,
        },
        scanSource: async () => SOURCE,
        readJourney: async () => {
          asked = true;
          return { whole: ['fixture:a', 'fixture:b'], entered: [], unread: [], stale: [], because: [] };
        },
      });

      expect(asked).toBe(false);
      expect(report.observations.map((entry) => entry.subject)).toEqual(['fixture:a', 'fixture:b']);
      expect(report.warnings?.join('\n')).toContain('did not narrow this run: yarn.lock changed');
      expect(report.warnings?.join('\n')).not.toContain('ruled out');
    });

    it('observes every subject when the diff moves what the run rests on, journal or not', async () => {
      // Nothing imports a harness config, so the journal records nothing about
      // it and would rule out both subjects over the file that governs them.
      const config = configOf({ source: { dirs: ['src'], relations: true, before: ['vitest.config.ts'] } });
      const harness = ['--- a/vitest.config.ts', '+++ b/vitest.config.ts', '@@ -1,1 +1,1 @@'].join('\n');
      let asked = false;

      const { report } = await runWith(config, BOTH, stored(['Button']), {
        since: { ref: 'origin/main', changed: ['vitest.config.ts'], diff: harness },
        scanSource: async () => SOURCE,
        scanRelations: async () =>
          relationsOfFiles([{ file: 'vitest.config.ts' }, { file: 'src/Button.tsx', declares: ['Button'] }]),
        readJourney: async () => {
          asked = true;
          return { whole: ['fixture:a', 'fixture:b'], entered: [], unread: ['vitest.config.ts'], stale: [], because: [] };
        },
      });

      expect(asked).toBe(false);
      expect(report.observations.map((entry) => entry.subject)).toEqual(['fixture:a', 'fixture:b']);
      expect(report.warnings?.join('\n')).toContain('the run rests on vitest.config.ts');
    });

    it('counts the two grounds apart', async () => {
      // The question an operator asks after seeing a run halve: which half of
      // this was the file graph, and which half was the journal. A single total
      // answers neither, and the interesting number is whichever one is zero.
      const { report } = await runWith(CONFIG, BOTH, stored(['Button']), {
        since: { ref: 'origin/main', changed: ['src/Button.tsx'], diff: DIFF },
        scanSource: async () => SOURCE,
        readJourney: async () => ({ whole: ['fixture:a', 'fixture:b'], entered: [], unread: [], because: [] }),
      });

      expect(report.warnings?.join('\n')).toContain(
        'ruled out 2 subjects: 0 by what the diff declares and reaches, ' +
          '2 by what the last run recorded as covered',
      );
    });

    it('never lets the journal rule out a subject the diff already ruled out', async () => {
      // The journal can keep a subject the structural ground removed, and cannot
      // remove one a second time. A journal recorded before `fixture:b` existed
      // must not be able to speak for it, and a run that let it would report the
      // same skip under two reasons.
      const { report } = await runWith(CONFIG, BOTH, stored(['Clock']), {
        since: { ref: 'origin/main', changed: ['src/Button.tsx'], diff: DIFF },
        scanSource: async () => SOURCE,
        readJourney: async () => ({ whole: [], entered: [], unread: [], because: [] }),
      });

      expect(report.notObserved?.map((entry) => entry.because)).toEqual([
        expect.stringContaining('this diff touched none of them'),
        expect.stringContaining('this diff touched none of them'),
      ]);
      expect(report.warnings?.join('\n')).toContain('was not narrowed by execution');
    });

    it('leaves the journal unread when git could not produce a diff', async () => {
      // `changed` without `diff` is a repository this run could list and not
      // read. The journal is indexed by line and has nothing to answer with, and
      // asking it anyway would answer from an empty hunk list — which reads as
      // *this diff reached nobody*.
      let asked = false;

      const { report } = await runWith(CONFIG, BOTH, stored(['Button']), {
        since: { ref: 'origin/main', changed: ['src/Button.tsx'] },
        scanSource: async () => SOURCE,
        readJourney: async () => {
          asked = true;
          return { whole: ['fixture:a', 'fixture:b'], entered: [], unread: [], because: [] };
        },
      });

      expect(asked).toBe(false);
      expect(report.observations.map((entry) => entry.subject)).toEqual(['fixture:a', 'fixture:b']);
    });
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
