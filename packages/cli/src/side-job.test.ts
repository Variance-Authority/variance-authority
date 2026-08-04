import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from './bin.js';
import { EXIT_CLEAN, EXIT_OPERATOR, EXIT_REVIEW } from './exit.js';

/**
 * `--exit-zero-on-changes`: a check that reports without gating the merge.
 *
 * The category is largely non-blocking in practice — Chromatic's job publishes
 * and the review happens in their UI afterwards — and this tool had no way to be
 * that except `|| true`, which also swallows exit 2. A job whose browser never
 * launched observed nothing, found nothing, and would have become a green tick:
 * the precise collapse ADR-0017 exists to prevent, reached through a shell
 * operator instead of through this code.
 *
 * Driven through `main` rather than through the helper, because the whole claim
 * is about the integer a CI step reads.
 */

async function repo(observation: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'variance-side-job-'));

  await writeFile(
    join(root, 'variance.config.json'),
    JSON.stringify({
      project: 'side-job',
      profile: 'chromium',
      viewport: { width: 1280, height: 800 },
      retention: 'ephemeral',
      subjects: { kind: 'list', ids: ['fixture:a'], collector: './collector.mjs' },
      fonts: [],
      report: 'report.json',
    }),
    'utf8',
  );

  await writeFile(
    join(root, 'report.json'),
    JSON.stringify({
      runVersion: 1,
      at: '2026-08-05T09:00:00.000Z',
      identity: {
        renderer: 'playwright-chromium',
        engine: 'chromium@131',
        platform: 'linux/x64',
        deviceScaleFactor: 1,
        fonts: [],
      },
      retention: 'ephemeral',
      observations: [observation],
      notObserved: [],
    }),
    'utf8',
  );

  return root;
}

const CHANGED = {
  subject: 'fixture:a',
  verdict: 'changed',
  because: '86 pixel(s) differ across 1 region(s)',
  changedPixels: 86,
  regions: [],
};

const UNCHANGED = { subject: 'fixture:a', verdict: 'unchanged', because: 'nothing moved', regions: [] };

async function report(root: string, flags: readonly string[]): Promise<{ code: number; err: string }> {
  let err = '';
  const code = await main(['report', '--config', join(root, 'variance.config.json'), ...flags], {
    out: () => undefined,
    err: (text) => {
      err += text;
    },
  });
  return { code, err };
}

describe('--exit-zero-on-changes', () => {
  it('turns a review into a clean exit', async () => {
    const root = await repo(CHANGED);

    expect((await report(root, [])).code).toBe(EXIT_REVIEW);
    expect((await report(root, ['--exit-zero-on-changes'])).code).toBe(EXIT_CLEAN);
  });

  it('says on stderr that the code was suppressed', async () => {
    // Not optional. A suppressed run is otherwise indistinguishable in a log from
    // a run that found nothing, and the whole value of a non-blocking check is
    // that somebody still reads it.
    const { err } = await report(await repo(CHANGED), ['--exit-zero-on-changes']);

    expect(err).toContain('changes need review');
    expect(err).toContain('reporting, not gating');
  });

  it('leaves an operator error at 2 — which is what `|| true` cannot do', async () => {
    // The reason this flag exists rather than a line of shell. A report that is
    // not there is a run that did not happen, and a job that treats that as
    // success is a green check over an unwatched surface.
    const root = await repo(CHANGED);
    await writeFile(join(root, 'report.json'), 'not json', 'utf8');

    expect((await report(root, ['--exit-zero-on-changes'])).code).toBe(EXIT_OPERATOR);
  });

  it('says nothing when there was nothing to suppress', async () => {
    const { code, err } = await report(await repo(UNCHANGED), ['--exit-zero-on-changes']);

    expect(code).toBe(EXIT_CLEAN);
    expect(err).toBe('');
  });
});
