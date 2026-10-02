import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { executionCollectorSource, testSelectionProbes } from '@variance-authority/sense/journal';
import { decodeExecutionIndex, recordedEyesAt } from '@variance-authority/sense/test-selection';
import { describe, expect, it } from 'vitest';
import { parseEyesJournal } from './archive.js';

const fixture = fileURLToPath(new URL('../test/fixtures/playwright-record', import.meta.url));
/** The spec, named against the checkout as every record names its files. */
const SPEC = 'packages/eyes/test/fixtures/playwright-record/spec/cart.spec.mjs';
const cli = fileURLToPath(new URL('../../../node_modules/@playwright/test/cli.js', import.meta.url));

const READY = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

if (!READY) {
  console.warn(
    '\npackages/eyes (record): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

const live = READY ? describe : describe.skip;

/** The page script, instrumented the way a recording build instruments it. */
async function pageScript(cacheRoot: string): Promise<string> {
  const path = join(fixture, 'cart.js');
  const source = await readFile(path, 'utf8');
  const { code } = testSelectionProbes({ root: fixture, cacheRoot }).transform(source, path) as { code: string };
  // A bundler resolves the collector import; a script tag has none, so the
  // collector goes in front of the module in its own block.
  return `{${executionCollectorSource()}}\n${code.replace(/^import "[^"]+";/, '')}`;
}

function playwright(env: Record<string, string>): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'test', '--config=playwright.config.mjs'], {
      cwd: fixture,
      env: { ...process.env, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, output }));
  });
}

live('Eyes in a recording Playwright run', () => {
  it('keeps every attempt\'s journal in the record, under the case the index names', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'variance-eyes-record-'));
    try {
      const cacheRoot = join(scratch, 'cache');
      const record = join(scratch, 'coverage.bin');
      const run = await playwright({
        EYES_CACHE: cacheRoot,
        EYES_RECORD: record,
        EYES_RESULTS: join(scratch, 'results'),
        EYES_PAGE: await pageScript(cacheRoot),
      });
      expect(run.code, run.output).toBe(0);

      const cases = decodeExecutionIndex(await readFile(record)).tests.map((test) => test.id);
      expect(cases).toEqual([
        `${SPEC} > adds one item`,
        `${SPEC} > passes on its second attempt`,
      ]);

      // The retry is a second attempt of one case, never a second case: both
      // attempts join the id the index gives it, and the attempt is a column.
      const rows = recordedEyesAt(record)!;
      expect(rows.map((row) => [row.case, row.attempt])).toEqual([
        [`${SPEC} > adds one item`, 1],
        [`${SPEC} > passes on its second attempt`, 1],
        [`${SPEC} > passes on its second attempt`, 2],
      ]);

      const journals = rows.map((row) => parseEyesJournal(row.journal));
      expect(journals.every((journal) => journal.complete)).toBe(true);
      const kinds = journals[0]!.attention.map((entry) =>
        entry.kind === 'eyes-phase' ? entry.phase : entry.kind);
      expect(kinds.filter((kind) => ['arrange', 'act', 'assert'].includes(kind))).toEqual([
        'arrange',
        'act',
        'assert',
      ]);
      expect(kinds).toContain('playwright-locator');
    } finally {
      await rm(scratch, { recursive: true, force: true });
    }
  }, 120_000);
});
