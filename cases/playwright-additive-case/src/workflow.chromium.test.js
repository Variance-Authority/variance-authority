import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = fileURLToPath(new URL('../../../node_modules/@playwright/test/cli.js', import.meta.url));

function playwright(arguments_, baselines, accepting = false) {
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
          ...(accepting ? { VA_ACCEPT: '1' } : {}),
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

describe('native Playwright Test consumer', () => {
  it('accepts then observes an in-place raster with native test and expect', async () => {
    const baselines = await mkdtemp(join(tmpdir(), 'variance-playwright-consumer-'));
    try {
      const unapproved = await playwright([], baselines);
      expect(unapproved.code, unapproved.output).toBe(1);

      const accepted = await playwright(['--update-snapshots=all'], baselines, true);
      expect(accepted, accepted.output).toMatchObject({ code: 0 });

      const unchanged = await playwright([], baselines);
      expect(unchanged, unchanged.output).toMatchObject({ code: 0 });
      expect(unchanged.output).toContain('1 passed');
    } finally {
      await rm(baselines, { recursive: true, force: true });
    }
  }, 60_000);
});
