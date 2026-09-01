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
    '\ncases/event-announcement-case: skipped.' +
      '\n  no browser — npx playwright install chromium\n',
  );
}

// A port per invocation, because two of these runs may be in flight at once and
// a fixed one would make this case the flake it exists to argue against.
let next = 4319;

function playwright(arguments_, results) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [cli, 'test', '--config=src/playwright.config.mjs', ...arguments_],
      {
        cwd: root,
        env: {
          ...process.env,
          VA_PORT: String((next += 1)),
          VA_RESULTS: join(results, 'playwright-results'),
          // Heads are in play. Not a path: nothing here writes a report, the
          // worker listens on a port it picked, and the address rides the cookie.
          VARIANCE_AUTHORITY_EVENTS: '1',
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

// Playwright's own artifact directory, and the only directory in this case.
async function inFreshResults(body) {
  const results = await mkdtemp(join(tmpdir(), 'variance-announcement-'));
  try {
    return await body(results);
  } finally {
    await rm(results, { recursive: true, force: true });
  }
}

live('a decision announced across two processes', () => {
  it('settles every wait with no duration written anywhere', async () => {
    const run = await inFreshResults((results) =>
      playwright(['--grep-invert=diagnosis'], results),
    );
    expect(run, run.output).toMatchObject({ code: 0 });
    expect(run.output).toContain('12 passed');
  }, 120_000);

  it('says what it heard when a wait does not settle', async () => {
    const run = await inFreshResults((results) => playwright(['--grep=diagnosis'], results));
    expect(run, run.output).toMatchObject({ code: 1 });

    // Coordinates that drifted: the list is the diagnostic, and it prints in
    // arrival order so a mistyped action is visible against its neighbours.
    expect(run.output).toContain('`checkout / upsell-modal / decidd` was never announced');
    expect(run.output).toContain('page  checkout / upsell-modal / decided');
    expect(run.output).toContain('pricing  pricing / upsell / quoted');
    expect(run.output).toContain('deciding (start)');

    // Nothing at all: a setup fact, said as one.
    expect(run.output).toContain('no listener is installed');
  }, 120_000);
});
