import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createEyesLog, eyesJournal } from '@variance-authority/eyes';
import { encodeExecutionIndex, testCoverageFile, withCaseSections, writeTestCoverage } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { recordedSteps } from './recorded-steps.js';

/** The journal of an attempt that queried a button by each of `names`, in order, as a watched screen records it. */
function queried(names: readonly string[], because?: string): ReturnType<typeof eyesJournal> {
  const log = createEyesLog();
  for (const name of names) log.record({ kind: 'rtl-query', query: 'getByRole', arguments: ['button', { name }], outcome: 'resolved', targets: [] });
  return eyesJournal(log.drain(), because);
}

interface Kept {
  readonly case: string;
  readonly attempt: number;
  readonly journal: ReturnType<typeof eyesJournal>;
}

/**
 * A record of one test run under two projects: two cases with the same file
 * and name, told apart by their ids. `journals` is the `eyes` section, or no
 * section when the run did not opt into Eyes.
 */
async function written(journals: readonly Kept[] | undefined): Promise<string> {
  const at = testCoverageFile(mkdtempSync(join(tmpdir(), 'variance-mcp-steps-')));
  const file = 'e2e/checkout.spec.ts';
  await writeTestCoverage(at, { version: 3, instrumentation: 'fixture-instrumentation', tests: [{ file, complete: true, preconditions: [] }], modules: [] });
  const index = encodeExecutionIndex({
    tests: [{ id: 'chromium', file, name: 'pays' }, { id: 'firefox', file, name: 'pays' }],
    modules: [],
  });
  const eyes = journals === undefined ? {} : {
    eyes: Buffer.from(`${JSON.stringify({
      version: 1,
      watched: ['chromium', 'firefox'],
      journals,
    })}\n`),
  };
  writeFileSync(at, withCaseSections(readFileSync(at), { index, ...eyes }));
  return at;
}

describe('recordedSteps', () => {
  it('reads the last attempt of the case its id names, whatever order the journals are kept in, though another case shares its file and name', async () => {
    const at = await written([
      { case: 'chromium', attempt: 2, journal: queried(['Pay', 'Retry'], 'the page closed') },
      { case: 'chromium', attempt: 1, journal: queried(['Pay']) },
      { case: 'firefox', attempt: 1, journal: queried(['Cancel']) },
    ]);

    expect(recordedSteps(at, 'chromium')).toEqual({
      steps: ['query getByRole("button", {"name":"Pay"})', 'query getByRole("button", {"name":"Retry"})'],
      attempt: 2,
      attempts: 2,
      partial: 'the page closed',
    });
    expect(recordedSteps(at, 'firefox')).toEqual({ steps: ['query getByRole("button", {"name":"Cancel"})'], attempt: 1, attempts: 1 });
  });

  it('says why no step is recorded: a watched case with no journal, a case not watched, and a run that kept none', async () => {
    const kept = await written([{ case: 'chromium', attempt: 1, journal: queried([]) }]);
    expect(recordedSteps(kept, 'firefox')).toEqual({ unrecorded: 'Eyes watched it and kept no journal' });
    expect(recordedSteps(kept, 'webkit')).toEqual({ unrecorded: 'Eyes did not watch it' });
    expect(recordedSteps(await written(undefined), 'chromium')).toEqual({ unrecorded: 'the run kept no Eyes journal' });
  });
});
