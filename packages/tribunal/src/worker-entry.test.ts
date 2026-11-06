import { describe, expect, it } from 'vitest';

import { createMemoryR2, createSqliteD1 } from './testing.js';
import entry, { type TribunalEnv } from './worker-entry.js';

const bindings = { DB: {}, BUCKET: createMemoryR2() } as unknown as TribunalEnv;

describe('a deployment that cannot start', () => {
  it('says why at the page, where a person looks first', async () => {
    const answer = await entry.fetch(new Request('https://tribunal.example/'), {
      ...bindings,
      REVIEW_CREDENTIALS: 'gihub',
    });

    expect(answer.status).toBe(500);
    expect(await answer.text()).toMatch(/gihub/);
  });
});

describe('the schedule', () => {
  it('sweeps what retention expired', async () => {
    const db = await createSqliteD1();

    await expect(
      entry.scheduled(null, { ...bindings, DB: db as never, INGEST_CREDENTIALS: 'token', INGEST_TOKEN: 'x'.repeat(32) }),
    ).resolves.toBeUndefined();
  });
});
