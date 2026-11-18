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

function playwright(results, env, ...flags) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'test', '--config=src/declared.config.mjs', ...flags], {
      cwd: root,
      env: { ...process.env, ...env, VA_RESULTS: results },
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

// The build `cases/storybook-case` makes: `yarn workspace @variance-authority/case-storybook build-storybook`.
const STORYBOOK_BUILT = existsSync(join(root, '..', 'storybook-case', 'storybook-static', 'index.json'));

if (BROWSER_AVAILABLE && !STORYBOOK_BUILT) {
  unbuilt(
    '\ncases/page-broker-case: Storybook\'s manager skipped.' +
      '\n  no build — yarn workspace @variance-authority/case-storybook build-storybook\n',
  );
}

live('@variance-authority/page-broker over apps that announce nothing', () => {
  async function declared(project, ...flags) {
    const results = await mkdtemp(join(tmpdir(), 'variance-page-broker-'));
    try {
      const env = { VA_PORT: await freePort(), VA_STORYBOOK_PORT: await freePort() };
      return await playwright(results, env, `--project=${project}`, ...flags);
    } finally {
      await rm(results, { recursive: true, force: true });
    }
  }

  it('reaches the outcomes of a shop that announces nothing', async () => {
    const run = await declared('shop');
    expect(run, run.output).toMatchObject({ code: 0 });
    expect(run.output).toMatch(/5 passed/);
  }, 120_000);

  (STORYBOOK_BUILT ? it : it.skip)(
    'tells where a search in Storybook\'s manager ended, thirty runs in a row',
    async () => {
      const run = await declared('storybook', '--repeat-each=30');
      expect(run, run.output).toMatchObject({ code: 0 });
      expect(run.output).toMatch(/120 passed/);
    },
    300_000,
  );
});
