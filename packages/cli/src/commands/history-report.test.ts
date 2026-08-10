import { describe, expect, it } from 'vitest';
import { createAbsentStore, type HistoryStore, type Instability, type Observation, type RunRecord } from '@variance-authority/history';
import type { Config } from '../config.js';
import { recordRun } from './history.js';
import { recordIfConfigured } from './history-report.js';
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

describe('a token that has been drifting', () => {
  it('finds the total no single review saw', async () => {
    // The example the whole tier exists for: eleven correct approvals of 2px
    // each are eleven correct decisions and one 22px change nobody made. The run
    // asks only about the tokens that moved *here*, which is why this costs one
    // request on the run that closes the loop and none on the others.
    const asked: string[] = [];
    const history: HistoryStore = {
      ...createAbsentStore(),
      async current() {
        return {
          observations: [],
          // What the record holds: the value before this run.
          tokens: [
            {
              project: 'shop',
              token: '--va-space-3',
              value: '18px',
              commit: 'c0',
              at: '2026-02-01T00:00:00.000Z',
            },
          ],
        };
      },
      async record() {},
      async valueJourney(token) {
        asked.push(token);
        return {
          token,
          window: {},
          values: [12, 14, 16, 18, 20].map((size, index) => ({
            project: 'shop',
            token,
            value: `${size}px`,
            commit: `c${index}`,
            at: `2026-02-0${index + 1}T00:00:00.000Z`,
          })),
          omitted: 0,
        };
      },
    };

    const recorded = await recordRun({
      config: CONFIG,
      store: history,
      identity: { run: 'r1', commit: 'c1' },
      at: '2026-03-01T10:00:00.000Z',
      swept: false,
      subjects: [{ subject: 'story:card', tokens: { '--va-space-3': '20px' } }],
    });

    expect(asked).toEqual(['--va-space-3']);
    expect(recorded.drift['--va-space-3']?.quantity).toMatchObject({ unit: 'px', net: 8 });
    // The number a reviewer of any one step could not have seen.
    expect(recorded.drift['--va-space-3']?.from).toBe('12px');
    expect(recorded.drift['--va-space-3']?.to).toBe('20px');
  });

  it('asks about nothing when every token resolved to what the record already held', async () => {
    // The usual run. A journey per token per run would be fifty round trips for
    // an answer identical to last run's.
    const asked: string[] = [];
    const history: HistoryStore = {
      ...createAbsentStore(),
      async current() {
        return {
          observations: [],
          tokens: [
            {
              project: 'shop',
              token: '--va-space-3',
              value: '12px',
              commit: 'c0',
              at: '2026-02-01T00:00:00.000Z',
            },
          ],
        };
      },
      async record() {},
      async valueJourney(token) {
        asked.push(token);
        return { kept: false, because: 'no record' };
      },
    };

    await recordRun({
      config: CONFIG,
      store: history,
      identity: { run: 'r1', commit: 'c1' },
      at: '2026-03-01T10:00:00.000Z',
      swept: false,
      subjects: [{ subject: 'story:card', tokens: { '--va-space-3': '12px' } }],
    });

    expect(asked).toEqual([]);
  });

  it('says nothing about a token the record has never seen', async () => {
    // A first sighting is not drift, and asking for a journey of one value would
    // produce a finding out of a token somebody has just introduced.
    const asked: string[] = [];
    const history: HistoryStore = {
      ...createAbsentStore(),
      async current() {
        return { observations: [], tokens: [] };
      },
      async record() {},
      async valueJourney(token) {
        asked.push(token);
        return { kept: false, because: 'no record' };
      },
    };

    const recorded = await recordRun({
      config: CONFIG,
      store: history,
      identity: { run: 'r1', commit: 'c1' },
      at: '2026-03-01T10:00:00.000Z',
      swept: false,
      subjects: [{ subject: 'story:card', tokens: { '--brand': '#0b6bcb' } }],
    });

    expect(asked).toEqual([]);
    expect(recorded.drift).toEqual({});
  });
});

describe('what the run reports about the record', () => {
  it('says nothing when no store is configured, and says so when one is and cannot be named', async () => {
    const quiet = await recordIfConfigured({
      config: { ...CONFIG, history: undefined } as Config,
      deps: {},
      at: '2026-03-01T10:00:00.000Z',
      swept: false,
      readings: [],
      observations: [],
    });
    // Not a warning: the operator did not ask for a record, and a run that
    // complained every time would teach its reader to skip the warnings.
    expect(quiet.warnings).toEqual([]);

    const unnamed = await recordIfConfigured({
      config: CONFIG,
      deps: { history: store([], []) },
      at: '2026-03-01T10:00:00.000Z',
      swept: false,
      readings: [],
      observations: [],
    });
    expect(unnamed.warnings[0]).toContain('this run has no id and commit');
  });

  it('records a subject that failed its second collection, which has no reading at all', async () => {
    // The loudest form of the thing being measured: collected once, and then not
    // collectable a second time. It reaches the report as an `unstable` finding
    // with no snapshot behind it, and dropping it would leave the worst
    // occurrence the only one never written down.
    const written: Written[] = [];
    await recordIfConfigured({
      config: CONFIG,
      deps: { history: store([], written) },
      at: '2026-03-01T10:00:00.000Z',
      identity: { run: 'r1', commit: 'c1' },
      swept: false,
      readings: [],
      observations: [
        { subject: 'story:card', verdict: 'changed', because: '', regions: [], unstable: UNSTABLE } as CliObservationRecord,
      ],
    });

    expect(written[0]?.instabilities).toHaveLength(1);
  });

  it('carries a flakiness answer into the report with a sentence attached', async () => {
    const answered = store([], [], {
      async flakiness(subject) {
        return {
          subject,
          window: {},
          runs: 20,
          sweeps: 12,
          occurrences: 6,
          absorbedRuns: 0,
          rate: 0.5,
          sweepsSince: 9,
          causes: [{ component: 'Clock', band: 'content', runs: 6 }],
          omittedRuns: 0,
          omittedOccurrences: 0,
        };
      },
    });

    const recorded = await recordIfConfigured({
      config: CONFIG,
      deps: { history: answered },
      at: '2026-03-01T10:00:00.000Z',
      identity: { run: 'r1', commit: 'c1' },
      swept: true,
      readings: [{ subject: 'story:card' }],
      observations: [
        { subject: 'story:card', verdict: 'changed', because: '', regions: [], unstable: UNSTABLE } as CliObservationRecord,
      ],
    });

    // The number and the instruction. "6 of 20" says the fixture is bad; "none in
    // the last 9 sweeps" says somebody already fixed it.
    expect(recorded.flakiness?.['story:card']?.occurrences).toBe(6);
    expect(recorded.flakiness?.['story:card']?.because).toContain(
      '9 sweep(s) have not seen it since',
    );
  });

  it('asks nothing about a subject that read the same way twice', async () => {
    const asked: string[] = [];
    const answered = store([], [], {
      async flakiness(subject) {
        asked.push(subject);
        return { kept: false, because: 'no record' };
      },
    });

    await recordIfConfigured({
      config: CONFIG,
      deps: { history: answered },
      at: '2026-03-01T10:00:00.000Z',
      identity: { run: 'r1', commit: 'c1' },
      swept: true,
      readings: [{ subject: 'story:card' }, { subject: 'story:other' }],
      observations: [
        { subject: 'story:card', verdict: 'unchanged', because: '', regions: [] } as CliObservationRecord,
      ],
    });

    expect(asked).toEqual([]);
  });
});
