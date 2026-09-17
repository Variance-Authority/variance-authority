import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { main } from './bin.js';
import { EXIT_OPERATOR } from './exit.js';

/**
 * `accept` in a repository where no run has happened.
 *
 * The state a cold install reaches first, and the one this command had no code
 * for: a configuration whose `report` path names a file nothing has written yet.
 * The reader then got an `ENOENT` stack under "a defect in the tool", which asks
 * them to file a bug about their own working directory.
 *
 * Driven through `main` rather than through `accept`, because the claim is about
 * the integer and the text a person standing in that repository actually gets.
 */

async function repoWithoutAReport(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'variance-accept-no-run-'));

  await writeFile(
    join(root, 'variance.config.json'),
    JSON.stringify({
      project: 'cold-install',
      profile: 'chromium',
      viewport: { width: 1280, height: 800 },
      retention: 'ephemeral',
      subjects: { kind: 'list', ids: ['cart/empty'], collector: './collector.mjs' },
      fonts: [],
      report: '.variance/report.json',
    }),
    'utf8',
  );

  return root;
}

async function accepting(root: string): Promise<{ code: number; err: string }> {
  let err = '';
  const code = await main(['accept', '--config', join(root, 'variance.config.json'), 'cart/empty'], {
    out: () => undefined,
    err: (text) => {
      err += text;
    },
  });
  return { code, err };
}

describe('accept with no run report on disk', () => {
  it('refuses as an operator error rather than crashing', async () => {
    const { code, err } = await accepting(await repoWithoutAReport());

    expect(code).toBe(EXIT_OPERATOR);
    // The words `bin.ts` prints over a stack trace. A missing report is a
    // statement about the repository, not about this tool.
    expect(err).not.toContain('does not have a code for');
    expect(err).not.toContain('ENOENT');
  });

  it('names the path it looked for and the configuration key that decided it', async () => {
    const root = await repoWithoutAReport();
    const { err } = await accepting(root);

    expect(err).toContain(join(root, '.variance', 'report.json'));
    expect(err).toContain('`report` in your configuration');
  });

  it('says a run must have happened, and names the dead end a cold reader hits', async () => {
    // Baselines written by the Playwright integration look exactly like a store
    // this command should promote into, and carry no run report at all. Naming
    // only the missing file would send that reader looking for a corrupted one.
    const { err } = await accepting(await repoWithoutAReport());

    expect(err).toContain('`variance run`');
    expect(err).toContain('@variance-authority/playwright-test');
    expect(err).toContain('playwright test --update-snapshots');
  });
});
