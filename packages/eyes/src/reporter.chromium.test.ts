import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { readEyesArchive } from './archive.js';

const fixture = fileURLToPath(new URL('../test/fixtures/playwright-run', import.meta.url));
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
    '\npackages/eyes (reporter): skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

const live = READY ? describe : describe.skip;

function playwright(archive: string, results: string): Promise<{ code: number | null; output: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'test', '--config=playwright.config.mjs'], {
      cwd: fixture,
      env: { ...process.env, EYES_ARCHIVE: archive, EYES_RESULTS: results },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.stderr.on('data', (chunk: Buffer) => (output += chunk.toString()));
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, output }));
  });
}

live('the eyes reporter over a real Playwright run', () => {
  it('folds one journal per test attempt, closed by the fixture', async () => {
    const scratch = await mkdtemp(join(tmpdir(), 'variance-eyes-run-'));
    try {
      const archivePath = join(scratch, 'eyes.json');
      const run = await playwright(archivePath, join(scratch, 'results'));
      expect(run.code, run.output).toBe(0);

      const archive = await readEyesArchive(archivePath);
      const journals = archive.tests
        .map((test) => ({ title: test.title, attempt: test.attempt, file: test.file, complete: test.complete }))
        .sort((a, b) => (`${a.title}${a.attempt}` < `${b.title}${b.attempt}` ? -1 : 1));
      expect(journals).toEqual([
        { title: 'adds one item', attempt: 0, file: 'packages/eyes/test/fixtures/playwright-run/spec/cart.spec.mjs', complete: true },
        { title: 'passes on its second attempt', attempt: 0, file: 'packages/eyes/test/fixtures/playwright-run/spec/cart.spec.mjs', complete: true },
        { title: 'passes on its second attempt', attempt: 1, file: 'packages/eyes/test/fixtures/playwright-run/spec/cart.spec.mjs', complete: true },
      ]);

      // Both attempts keep the id Playwright gave the test; the attempt tells them apart.
      const retried = archive.tests.filter((test) => test.title === 'passes on its second attempt');
      expect(new Set(retried.map((test) => test.id)).size).toBe(1);

      const adds = archive.tests.find((test) => test.title === 'adds one item')!;
      const kinds = adds.attention.map((entry) =>
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
