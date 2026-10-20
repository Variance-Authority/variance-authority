import { existsSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, it, vi } from 'vitest';
import { selected } from './__fixtures__/carry-contract.js';
import { CONTRACT_SEED, FailedHistory, failuresOf, generated, historyOf } from './__fixtures__/carry-histories.js';
import { commentThenRunElsewhere } from './__fixtures__/carry-stories.js';
import { testCoverageFile } from './index.js';

// The fault the histories exist to catch, injected into the landing: every
// edit read as one that changes how the module loads, so a comment reaches
// every region its lines moved, as a line-only carry would.
vi.mock('./edit-readings.js', async (original) => {
  const actual = await original<typeof import('./edit-readings.js')>();
  return {
    ...actual,
    editReadings: async (...args: Parameters<typeof actual.editReadings>) =>
      new Map([...(await actual.editReadings(...args)).keys()].map((key) => [key, 'load' as const])),
  };
});

/** Two comments and a run elsewhere: the line-only landing owes a run for a comment. */
const SEED = 4864;

it('fails a line-only landing, names the seed, shrinks to a minimal history and keeps its walk', async () => {
  const failed = await generated(SEED, selected, { replays: 5 }).then(() => undefined, (error: unknown) => error);
  expect(failed).toBeInstanceOf(FailedHistory);
  const { message, actions, failures, kept, exhausted } = failed as FailedHistory;
  try {
    expect(message).toContain(`seed ${SEED}`);
    expect(message).toContain(`CARRY_SEED=${SEED}`);
    expect(failures).not.toEqual([]);

    expect(exhausted).toBe(false);
    expect(actions.length).toBeLessThan(historyOf(SEED).length);
    expect(await failuresOf(actions, selected)).not.toEqual([]);
    for (const at of actions.keys()) {
      expect(await failuresOf(actions.filter((_, other) => other !== at), selected), `without action ${at}`).toEqual([]);
    }

    const artifacts = resolve(kept, 'artifacts');
    const texts = (await readdir(artifacts)).filter((file) => /^text-\d+\.ts$/u.test(file));
    const edits = actions.filter(({ action }) => action !== 'run' && action !== 'run elsewhere');
    expect(texts).toHaveLength(1 + edits.length);
    const steps = JSON.parse(await readFile(resolve(artifacts, 'actions.json'), 'utf8')) as { readonly action: string }[];
    expect(steps.map(({ action }) => action)).toEqual(expect.arrayContaining(['open', 'commit', 'run elsewhere']));
    expect(existsSync(testCoverageFile(resolve(kept, 'repository'), { cacheRoot: resolve(kept, 'cache') }))).toBe(true);
    const checks = JSON.parse(await readFile(resolve(artifacts, 'checks.json'), 'utf8')) as {
      readonly expected: { readonly missing: readonly string[]; readonly unnecessary: readonly string[] };
      readonly actual: { readonly missing: readonly string[]; readonly unnecessary: readonly string[] };
    }[];
    expect(checks.some(({ expected, actual }) =>
      expected.missing.length + expected.unnecessary.length === 0 && actual.missing.length + actual.unnecessary.length > 0)).toBe(true);
  } finally {
    await rm(kept, { recursive: true, force: true });
  }
});

it('keeps a failed journey\'s texts, actions and checks beside its record, and names where', async () => {
  const failed = await commentThenRunElsewhere(selected).then(() => undefined, (error: unknown) => error);
  expect(failed).toBeInstanceOf(Error);
  const kept = /the walk is kept at (.+)$/mu.exec((failed as Error).message)?.[1];
  expect(kept).toBeDefined();
  try {
    const artifacts = resolve(kept!, 'artifacts');
    expect(await readdir(artifacts)).toEqual(expect.arrayContaining(['actions.json', 'checks.json', 'text-0.ts']));
    expect(existsSync(testCoverageFile(resolve(kept!, 'repository'), { cacheRoot: resolve(kept!, 'cache') }))).toBe(true);
  } finally {
    if (kept !== undefined) await rm(kept, { recursive: true, force: true });
  }
});

it('fails the contract\'s seed under a line-only landing, so the seed still carries the fault', async () => {
  const failed = await generated(CONTRACT_SEED, selected, { replays: 0 }).then(() => undefined, (error: unknown) => error);
  expect(failed).toBeInstanceOf(FailedHistory);
  await rm((failed as FailedHistory).kept, { recursive: true, force: true });
});
