import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { describe, expect, it } from 'vitest';
import { unbuilt } from '../../unbuilt.mjs';

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
  unbuilt(
    '\ncases/page-broker-case: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

/** A port nothing listens on, so the shop does not meet another case's server. */
function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.on('error', reject);
    server.listen(0, () => {
      const { port } = server.address();
      server.close(() => resolve(String(port)));
    });
  });
}

function playwright(results, port) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'test', '--config=src/playwright.config.mjs'], {
      cwd: root,
      env: { ...process.env, VA_PORT: port, VA_RESULTS: results },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
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

live('page broker spike', () => {
  it('passes every rule its README pins in src/spec', async () => {
    const results = await mkdtemp(join(tmpdir(), 'variance-page-broker-'));
    try {
      const run = await playwright(results, await freePort());
      expect(run, run.output).toMatchObject({ code: 0 });
      expect(run.output).toMatch(/\d+ passed/);
    } finally {
      await rm(results, { recursive: true, force: true });
    }
  }, 300_000);
});
