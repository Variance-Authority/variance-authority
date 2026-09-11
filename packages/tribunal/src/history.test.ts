import { beforeEach, describe, expect, it } from 'vitest';
import type { Digest } from '@variance-authority/core/format';
import type { Observation, RunRecord, TokenValue, Window } from '@variance-authority/history';
import {
  HistoryWriteConflict,
  createBackedStore,
  type HistoryBackend,
} from '@variance-authority/server';
import { createSqliteBackend } from '@variance-authority/server/sqlite';
import { createD1Backend } from './history.js';
import { createSqliteD1, type SqliteD1 } from './testing.js';

/**
 * Acceptance 7, and it is the only shape of test worth writing for this file.
 *
 * `createD1Backend` is a transcription of the SQLite backend. A test that
 * asserted its answers against hand-written expectations would be a second
 * opinion about what churn means — which is exactly what the `HistoryBackend`
 * seam exists to make impossible, since the arithmetic lives above both engines
 * and neither is allowed one of its own.
 *
 * So the assertion is agreement, with the *other engine* as the oracle. Its
 * answers are pinned by its own suite against hand-written histories, so this is
 * not two implementations agreeing on nothing in particular: it is one verified
 * answer, reached twice.
 */

const WINDOW: Window = { since: '2026-01-01T00:00:00.000Z', until: '2026-12-31T23:59:59.000Z' };

/**
 * A run, at the commit its rows claim.
 *
 * `r-1` is recorded at `c-1`, matching what `observation` and `token` default to.
 * A fixture whose run and whose rows named different commits would be a history
 * no writer can produce — a `TokenValue` is built from the `RunRecord` that
 * carries it — and it would take the journey join with it.
 */
function run(id: string, at: string, commit = `c-${id.slice(2)}`): RunRecord {
  return { project: 'todomvc', run: id, commit, profile: 'chromium', at };
}

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    project: 'todomvc',
    subject: 'story:card',
    component: 'Button',
    band: 'style',
    hash: 'aaaa' as Digest,
    profile: 'chromium',
    commit: 'c-1',
    run: 'r-1',
    at: '2026-03-01T00:00:00.000Z',
    accepted: true,
    ...overrides,
  };
}

function token(overrides: Partial<TokenValue> = {}): TokenValue {
  return {
    project: 'todomvc',
    token: '--va-space-3',
    value: '12px',
    commit: 'c-1',
    at: '2026-03-01T00:00:00.000Z',
    ...overrides,
  };
}

/** Every write the two backends are given, so neither can be fed a different history. */
const HISTORY: readonly {
  readonly run: RunRecord;
  readonly observations: readonly Observation[];
  readonly tokens: readonly TokenValue[];
}[] = [
  {
    run: run('r-1', '2026-03-01T00:00:00.000Z'),
    observations: [observation()],
    tokens: [token()],
  },
  // A quiet run. The denominator that stops "changed in 4 of 4 runs" being said
  // about a component that changed in 4 of 40.
  { run: run('r-2', '2026-03-02T00:00:00.000Z'), observations: [], tokens: [] },
  {
    run: run('r-3', '2026-03-03T00:00:00.000Z'),
    observations: [
      observation({ run: 'r-3', commit: 'c-3', hash: 'bbbb' as Digest, at: '2026-03-03T00:00:00.000Z' }),
      observation({
        run: 'r-3',
        commit: 'c-3',
        subject: 'story:toolbar',
        hash: 'cccc' as Digest,
        at: '2026-03-03T00:00:00.000Z',
        file: 'src/ds/components.tsx',
      }),
    ],
    tokens: [token({ run: 'r-3', commit: 'c-3', value: '20px', at: '2026-03-03T00:00:00.000Z' })],
  },
  {
    run: run('r-4', '2026-03-04T00:00:00.000Z'),
    observations: [
      observation({
        run: 'r-4',
        commit: 'c-4',
        component: 'Toggle',
        band: 'structure',
        hash: 'dddd' as Digest,
        at: '2026-03-04T00:00:00.000Z',
        accepted: false,
      }),
    ],
    tokens: [],
  },
];

let d1: SqliteD1;
let backends: readonly { readonly name: string; readonly backend: HistoryBackend }[];

beforeEach(async () => {
  d1 = await createSqliteD1();
  backends = [
    { name: 'sqlite', backend: createSqliteBackend({ path: ':memory:' }) },
    { name: 'D1', backend: createD1Backend(d1) },
  ];

  for (const { backend } of backends) {
    for (const write of HISTORY) {
      await backend.append(write.run, write.observations, write.tokens);
    }
    // Arriving after every write, because that is the only order there is: a run
    // records what it observed, and a reviewer accepts it later. `r-4` is left
    // unapproved, which is what keeps its value out of the journey below.
    await backend.appendApprovals(
      ['r-1', 'r-3'].map((id) => ({
        project: 'todomvc',
        subject: 'story:card',
        run: id,
        at: '2026-04-01T00:00:00.000Z',
      })),
    );
  }
});

/** The same question, asked of both, as the store the service actually wraps. */
async function bothAnswer(ask: (store: ReturnType<typeof createBackedStore>) => Promise<unknown>) {
  const answers: Record<string, unknown> = {};
  for (const { name, backend } of backends) {
    answers[name] = await ask(createBackedStore(backend, 'todomvc'));
  }
  return answers;
}

function agreed(answers: Record<string, unknown>): void {
  expect(answers['D1']).toEqual(answers['sqlite']);
}

describe('D1 answers what SQLite answers', () => {
  it('on when an area last changed', async () => {
    const answers = await bothAnswer((store) => store.lastChanged('story:card', 'Button'));

    agreed(answers);
    // Pinned as well as compared: two backends agreeing on a wrong answer is not
    // a pass, and this is the row a caller acts on.
    expect((answers['D1'] as { readonly hash: string }).hash).toBe('bbbb');
  });

  it('on churn, including the quiet run in the denominator', async () => {
    const answers = await bothAnswer((store) => store.churn('Button', WINDOW));

    agreed(answers);
    expect(answers['D1']).toMatchObject({ component: 'Button', runs: 4 });
  });

  it('on a token journey through the runs a reviewer approved', async () => {
    const answers = await bothAnswer((store) => store.valueJourney('--va-space-3', WINDOW));

    agreed(answers);
    expect(
      (answers['D1'] as { readonly values: readonly TokenValue[] }).values.map((v) => v.value),
    ).toEqual(['12px', '20px']);
  });

  it('on reach, and on which subjects arrived inside the window', async () => {
    const answers = await bothAnswer((store) => store.reach('Button', WINDOW));

    agreed(answers);
    expect(answers['D1']).toMatchObject({
      subjects: ['story:card', 'story:toolbar'],
      arrived: ['story:card', 'story:toolbar'],
    });
  });

  it('on a window that excludes the earlier runs', async () => {
    const later: Window = { since: '2026-03-03T00:00:00.000Z' };
    agreed(await bothAnswer((store) => store.churn('Button', later)));
    agreed(await bothAnswer((store) => store.reach('Button', later)));
  });

  it('on what a limit excluded, as a count rather than a flag', async () => {
    const answers = await bothAnswer((store) =>
      store.churn('Button', { ...WINDOW, limit: 1 } as Window),
    );

    agreed(answers);
    expect(answers['D1']).toMatchObject({ omittedRuns: 3 });
  });
});

describe('lineage', () => {
  it('accepts the same run twice', async () => {
    // A caller whose components were approved separately writes twice, and a run
    // counted twice halves every rate derived from it forever.
    for (const { backend } of backends) {
      await backend.append(run('r-1', '2026-03-01T00:00:00.000Z'), [], []);
    }

    agreed(await bothAnswer((store) => store.churn('Button', WINDOW)));
    expect(await bothAnswer((store) => store.churn('Button', WINDOW))).toMatchObject({
      D1: { runs: 4 },
    });
  });

  it('refuses a run id that claims a second commit', async () => {
    const second = run('r-1', '2026-03-01T00:00:00.000Z', 'a-different-commit');

    for (const { name, backend } of backends) {
      await expect(
        backend.append(second, [], []),
        `${name} must refuse it`,
      ).rejects.toThrow(HistoryWriteConflict);
    }
  });

  it('leaves nothing behind when a write in the batch fails', async () => {
    // Rows without their run leave a change with no denominator; a run without
    // its rows is a quiet run that was not quiet. Either way the store is worse
    // than useless, so the batch has to be all or nothing.
    const backend = createD1Backend(d1);
    const doomed = observation({ run: 'r-9', at: 'not-an-instant' });

    await expect(backend.append(run('r-9', '2026-03-09T00:00:00.000Z'), [doomed], [])).rejects.toThrow();

    const runs = await d1
      .prepare('SELECT COUNT(*) AS n FROM runs WHERE run = ?')
      .bind('r-9')
      .first<{ readonly n: number }>();
    expect(runs?.n).toBe(0);
  });
});

describe('the record is append-only, and the database is what says so', () => {
  it('refuses to rewrite an observation', async () => {
    // Not a rule this package remembers to apply — a trigger, so a person at a
    // `wrangler d1 execute` prompt hits it too. Two hashes for one key are two
    // rows; an update is the merge the whole store exists to escape.
    await expect(
      d1.prepare("UPDATE observations SET hash = 'zzzz' WHERE run = ?").bind('r-1').run(),
    ).rejects.toThrow(/append-only/);
  });

  it('refuses to delete a run', async () => {
    await expect(d1.prepare('DELETE FROM runs WHERE run = ?').bind('r-2').run()).rejects.toThrow(
      /inflates every rate/,
    );
  });
});

describe('rows are not cast on the way out', () => {
  /** A row this package did not write, as an older or newer build would leave one. */
  async function insertRaw(band: string, profile: string): Promise<void> {
    await d1
      .prepare(
        `INSERT INTO observations
           (project, subject, component, band, hash, profile, "commit", run, at, at_ms, accepted, file)
         VALUES ('todomvc', 'story:card', 'Button', ?, 'eeee', ?, 'c-5', 'r-5',
                 '2026-03-05T00:00:00.000Z', ?, 1, NULL)`,
      )
      .bind(band, profile, Date.parse('2026-03-05T00:00:00.000Z'))
      .run();
  }

  it('refuses an observation whose band is not one of the three', async () => {
    await insertRaw('colour', 'chromium');

    await expect(
      createD1Backend(d1).lastObservation({ subject: 'story:card', component: 'Button' }),
    ).rejects.toThrow(/unknown band/);
  });

  it('refuses an observation whose profile core has never heard of', async () => {
    await insertRaw('style', 'webgl');

    await expect(
      createD1Backend(d1).lastObservation({ subject: 'story:card', component: 'Button' }),
    ).rejects.toThrow(/unknown profile/);
  });
});
