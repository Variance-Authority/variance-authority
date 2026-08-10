import { describe, expect, it } from 'vitest';
import { createAbsentStore, type HistoryStore, type Instability, type Observation, type RunRecord } from '@variance-authority/history';
import { environmentKey, profileById, type SemanticSnapshot } from '@variance-authority/core';
import type { Config } from '../config.js';
import { identityOf, recordRun } from './history.js';
import type { CliObservationRecord } from './run-report.js';

/**
 * The run's dealings with a history record.
 *
 * Two failures are worth more than the rest of this file put together, and both
 * are silent. A run that records nothing and says nothing produces a history that
 * stops growing the day somebody changes CI provider, with every later drift
 * answer computed over a window missing runs nobody knew were absent. And a run
 * that records *everything* every time — because it could not read what was
 * already there — turns the store into a change log of nothing happening.
 */

const CONFIG = {
  project: 'shop',
  profile: 'chromium',
  history: { endpoint: 'http://history.internal:7788', token: 't' },
} as unknown as Config;

/** A snapshot with one component in it, as `hashComponents` will read it. */
function snapshot(text: string): SemanticSnapshot {
  return {
    formatVersion: 1,
    subject: { id: 'story:card', kind: 'fixture' },
    profile: profileById('chromium'),
    environment: environmentKey({
      profile: 'chromium',
      engine: 'chromium@131',
      ruleset: 'test',
      allowlist: 'test',
      viewport: { width: 800, height: 600, deviceScaleFactor: 1 },
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
      text,
      provenance: { owners: [{ name: 'Clock', propsDigest: 'v1:x' }] },
      children: [],
    },
    styleProvenance: [],
    diagnostics: [],
  } as unknown as SemanticSnapshot;
}

interface Written {
  readonly run: RunRecord;
  readonly observations: readonly Observation[];
  readonly instabilities: readonly Instability[];
}

function store(
  previous: readonly Observation[],
  written: Written[],
  overrides: Partial<HistoryStore> = {},
): HistoryStore {
  return {
    ...createAbsentStore(),
    async current() {
      return { observations: previous, tokens: [] };
    },
    async record(run, observations, _tokens, instabilities) {
      written.push({ run, observations, instabilities: instabilities ?? [] });
    },
    ...overrides,
  };
}

const UNSTABLE: CliObservationRecord['unstable'] = {
  components: [{ name: 'Clock', file: 'src/Clock.tsx:22' }],
  bands: ['content'],
  because: 'read twice, disagreed',
};

describe('naming a run', () => {
  it('takes the flags first, then whichever CI it is inside', () => {
    expect(identityOf({ run: 'r', commit: 'c' }, { GITHUB_RUN_ID: '9' })).toEqual({
      run: 'r',
      commit: 'c',
    });
    expect(identityOf({}, { GITHUB_RUN_ID: '9', GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: 'abc' })).toEqual(
      { run: 'github-9-2', commit: 'abc' },
    );
    expect(identityOf({}, { CI_PIPELINE_ID: '4', CI_COMMIT_SHA: 'def' })).toEqual({
      run: 'gitlab-4',
      commit: 'def',
    });
  });

  it('never completes a pair from two sources, and answers nothing when neither has both', () => {
    // A run id from one system with a commit from another describes a run that
    // never existed, and it would be indistinguishable from a real row forever.
    expect(identityOf({ run: 'r' }, { CI_COMMIT_SHA: 'def' })).toBeUndefined();
    expect(identityOf({}, {})).toBeUndefined();
  });

  it('counts a re-run as its own run', () => {
    // Same commit, second attempt. Merged under one id, two runs would be
    // recorded as one and every rate over the window would be slightly too low.
    const first = identityOf({}, { GITHUB_RUN_ID: '9', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'a' });
    const second = identityOf({}, { GITHUB_RUN_ID: '9', GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: 'a' });

    expect(first?.run).not.toBe(second?.run);
  });
});

describe('recording a run', () => {
  it('writes only what moved, against the rows the store already holds', async () => {
    const written: Written[] = [];
    const first = store([], written);

    await recordRun({
      config: CONFIG,
      store: first,
      identity: { run: 'r1', commit: 'c1' },
      at: '2026-03-01T10:00:00.000Z',
      swept: false,
      subjects: [{ subject: 'story:card', snapshot: snapshot('12:00') }],
    });

    const recorded = written[0]?.observations ?? [];
    expect(recorded.length).toBeGreaterThan(0);

    // The same reading again, with the store now holding what the first run
    // wrote. Nothing moved, so nothing is written — the rule the whole design's
    // affordability rests on.
    const second: Written[] = [];
    await recordRun({
      config: CONFIG,
      store: store(recorded, second),
      identity: { run: 'r2', commit: 'c2' },
      at: '2026-03-02T10:00:00.000Z',
      swept: false,
      subjects: [{ subject: 'story:card', snapshot: snapshot('12:00') }],
    });

    expect(second[0]?.observations).toEqual([]);
    // And the run itself is still recorded. A quiet run is the denominator.
    expect(second[0]?.run.run).toBe('r2');
  });

  it('records every observation as unapproved, whatever the run decided', async () => {
    // Acceptance is a later decision. A run that approved its own observations
    // would put every unreviewed change into a drift total.
    const written: Written[] = [];
    await recordRun({
      config: CONFIG,
      store: store([], written),
      identity: { run: 'r1', commit: 'c1' },
      at: '2026-03-01T10:00:00.000Z',
      swept: false,
      subjects: [{ subject: 'story:card', snapshot: snapshot('12:00') }],
    });

    expect((written[0]?.observations ?? []).every((row) => !row.accepted)).toBe(true);
  });

  it('writes an instability per named component and band, and carries the rule that absorbed it', async () => {
    const written: Written[] = [];
    await recordRun({
      config: CONFIG,
      store: store([], written),
      identity: { run: 'r1', commit: 'c1' },
      at: '2026-03-01T10:00:00.000Z',
      swept: true,
      subjects: [
        { subject: 'story:card', unstable: UNSTABLE },
        {
          subject: 'route/home',
          unstable: { ...UNSTABLE, absorbed: { rule: 'routes', level: 'layout' } },
        },
      ],
    });

    expect(written[0]?.instabilities).toEqual([
      expect.objectContaining({ subject: 'story:card', component: 'Clock', band: 'content' }),
      expect.objectContaining({ subject: 'route/home', absorbedBy: 'routes' }),
    ]);
    // The denominator travels with the run, not with the finding.
    expect(written[0]?.run.swept).toBe(true);
  });

  it('records an occurrence it could not name rather than dropping it', async () => {
    // The collector proved the instability and gave nobody the means to name it.
    // A store that dropped the row would answer "never" about a subject that has
    // been failing all week.
    const written: Written[] = [];
    await recordRun({
      config: CONFIG,
      store: store([], written),
      identity: { run: 'r1', commit: 'c1' },
      at: '2026-03-01T10:00:00.000Z',
      swept: false,
      subjects: [
        { subject: 'story:card', unstable: { components: [], bands: [], because: 'no snapshot' } },
      ],
    });

    expect(written[0]?.instabilities).toHaveLength(1);
    expect(written[0]?.instabilities[0]).not.toHaveProperty('component');
  });

  it('stops when the store is keeping no record, rather than writing everything', async () => {
    // An absent store's `current` refuses. Reading that as an empty previous set
    // would compute a full set of rows and hand them to a `record` that discards
    // them — nothing wrong, nothing kept, and nobody finds it for a cycle.
    const written: Written[] = [];
    const recorded = await recordRun({
      config: CONFIG,
      store: { ...createAbsentStore(), async record(...args) { written.push(args as never); } },
      identity: { run: 'r1', commit: 'c1' },
      at: '2026-03-01T10:00:00.000Z',
      swept: false,
      subjects: [{ subject: 'story:card', snapshot: snapshot('12:00') }],
    });

    expect(written).toEqual([]);
    expect(recorded.warnings[0]).toContain('no history store is configured');
  });

  it('turns a failed write into a warning, never into a failed run', async () => {
    // The run observed what it observed. A history service that is down must not
    // make a correct run red — and must not be silent either.
    const recorded = await recordRun({
      config: CONFIG,
      store: store([], [], {
        async record() {
          throw new Error('connection refused');
        },
      }),
      identity: { run: 'r1', commit: 'c1' },
      at: '2026-03-01T10:00:00.000Z',
      swept: false,
      subjects: [{ subject: 'story:card', snapshot: snapshot('12:00') }],
    });

    expect(recorded.observations).toBe(0);
    expect(recorded.warnings[0]).toContain('connection refused');
    expect(recorded.warnings[0]).toContain('rows are lost');
  });
});

describe('the tokens a run resolved', () => {
  it('writes one row per token, not one per subject that inherited it', async () => {
    // Three hundred subjects inherit the same `:root` declarations. A row each
    // would be three hundred copies of one answer, and a `TokenValue` carries no
    // subject because the question is what the *product's* spacing scale drifted
    // to.
    const written: Written[] = [];
    const store_ = {
      ...store([], []),
      async record(run: RunRecord, _o: unknown, tokens: unknown) {
        written.push({ run, observations: [], instabilities: [], tokens } as never);
      },
    } as unknown as HistoryStore;

    await recordRun({
      config: CONFIG,
      store: store_,
      identity: { run: 'r1', commit: 'c1' },
      at: '2026-03-01T10:00:00.000Z',
      swept: false,
      subjects: [
        { subject: 'story:card', tokens: { '--va-space-3': '12px', '--brand': '#0b6bcb' } },
        { subject: 'story:panel', tokens: { '--va-space-3': '12px' } },
      ],
    });

    expect((written[0] as unknown as { tokens: readonly { token: string; value: string }[] }).tokens)
      .toEqual([
        { project: 'shop', token: '--brand', value: '#0b6bcb', commit: 'c1', at: '2026-03-01T10:00:00.000Z' },
        { project: 'shop', token: '--va-space-3', value: '12px', commit: 'c1', at: '2026-03-01T10:00:00.000Z' },
      ]);
  });

  it('records nothing for a token with two values, and says how many it dropped', async () => {
    // A themed subtree that overrides `--brand` is a legitimate second answer.
    // Picking either would put a step in a journey that its reader would trace to
    // a commit and be unable to reproduce.
    const written: Written[] = [];
    const store_ = {
      ...store([], []),
      async record(run: RunRecord, _o: unknown, tokens: unknown) {
        written.push({ run, observations: [], instabilities: [], tokens } as never);
      },
    } as unknown as HistoryStore;

    const recorded = await recordRun({
      config: CONFIG,
      store: store_,
      identity: { run: 'r1', commit: 'c1' },
      at: '2026-03-01T10:00:00.000Z',
      swept: false,
      subjects: [
        { subject: 'story:light', tokens: { '--brand': '#0b6bcb' } },
        { subject: 'story:dark', tokens: { '--brand': '#ffffff' } },
      ],
    });

    expect((written[0] as unknown as { tokens: readonly unknown[] }).tokens).toEqual([]);
    expect(recorded.warnings[0]).toContain('--brand');
    expect(recorded.warnings[0]).toContain('no value was picked');
  });
});
