/// <depends path="./bin.ts" />
/// <depends path="../../route-collector/src/index.ts" />
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

/**
 * A stranger's first run, between `npm install` and installing a browser.
 *
 * The built program, a shipped collector that opens its browser while it loads,
 * and an empty `PLAYWRIGHT_BROWSERS_PATH`: the machine running this test may
 * hold every browser there is, and Playwright finds none of them.
 */

const BIN = fileURLToPath(new URL('../dist/bin.js', import.meta.url));
const ROUTE_COLLECTOR = new URL('../../route-collector/dist/index.js', import.meta.url).href;

const CONFIG = {
  project: 'first-run',
  profile: 'chromium',
  viewport: { width: 320, height: 240 },
  retention: 'durable',
  subjects: { kind: 'list', ids: ['home'], collector: './collector.mjs' },
  baselines: { kind: 'directory', root: 'baselines' },
  report: 'out/report.json',
};

describe('`variance run` on a machine with no browser', () => {
  let at: string | undefined;

  afterEach(() => {
    if (at !== undefined) rmSync(at, { recursive: true, force: true });
  });

  it("exits 2 with Playwright's reason, and calls nothing a defect in the tool", () => {
    at = realpathSync(mkdtempSync(join(tmpdir(), 'va-no-browser-')));
    const browsers = join(at, 'browsers');
    mkdirSync(browsers);
    writeFileSync(join(at, 'variance.config.json'), JSON.stringify(CONFIG));
    writeFileSync(
      join(at, 'collector.mjs'),
      `import { routeCollector } from ${JSON.stringify(ROUTE_COLLECTOR)};\n` +
        "export default routeCollector({ routes: { home: 'about:blank' } });\n",
    );

    const run = spawnSync(process.execPath, [BIN, 'run', '--config', join(at, 'variance.config.json')], {
      cwd: at,
      encoding: 'utf8',
      env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers },
    });

    expect(run.stderr).not.toContain('defect in the tool');
    expect(run.stderr).toContain('the browser did not start');
    // Playwright words the command for the package manager that started it.
    expect(run.stderr).toContain('playwright install');
    expect(run.status).toBe(2);
  });
});
