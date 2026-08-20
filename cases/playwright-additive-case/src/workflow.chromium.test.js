import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { describe, expect, it } from 'vitest';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = fileURLToPath(new URL('../../../node_modules/@playwright/test/cli.js', import.meta.url));

const BROWSER_AVAILABLE = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const live = BROWSER_AVAILABLE ? describe : describe.skip;

if (!BROWSER_AVAILABLE) {
  console.warn(
    '\ncases/playwright-additive-case: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

function playwright(arguments_, baselines) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [cli, 'test', '--config=src/playwright.config.mjs', ...arguments_],
      {
        cwd: root,
        env: {
          ...process.env,
          VA_BASELINES: baselines,
          VA_RESULTS: join(baselines, 'playwright-results'),
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code, output }));
  });
}

live('native Playwright Test consumer', () => {
  it('accepts then observes an in-place raster with native test and expect', async () => {
    const baselines = await mkdtemp(join(tmpdir(), 'variance-playwright-consumer-'));
    try {
      const unapproved = await playwright([], baselines);
      expect(unapproved.code, unapproved.output).toBe(1);

      // The documented command, run exactly as the README gives it: no branch in
      // the spec around `assertUnchanged`, and exit 0 for a subject it promoted.
      const accepted = await playwright(['--update-snapshots=all'], baselines);
      expect(accepted, accepted.output).toMatchObject({ code: 0 });

      const unchanged = await playwright([], baselines);
      expect(unchanged, unchanged.output).toMatchObject({ code: 0 });
      expect(unchanged.output).toContain('1 passed');
    } finally {
      await rm(baselines, { recursive: true, force: true });
    }
  }, 60_000);
});
