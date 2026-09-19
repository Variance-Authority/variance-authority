import { execFileSync, spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * One runner, two adoptions, both driven by the real `rstest` CLI.
 *
 * The capture half never opens a browser: an Rstest `jsdom` test writes an
 * artifact and exits, and a separate CLI process paints it. The e2e half is the
 * opposite — `@rstest/playwright` hands the body a live page and the comparison
 * happens inside the test, so acceptance is Rstest's own `-u` and the evidence
 * is what the three processes exited with.
 */

const CASE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(CASE, '../..');
const RSTEST = join(ROOT, 'node_modules/@rstest/core/bin/rstest.js');
const CLI = join(ROOT, 'packages/cli/dist/bin.js');
const COLLECTOR = join(CASE, 'collector/index.mjs');

const BROWSER_AVAILABLE = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const READY = BROWSER_AVAILABLE && existsSync(CLI);
const live = READY ? describe : describe.skip;

if (!READY) {
  console.warn(
    '\ncases/rstest-case: skipped.' +
      (BROWSER_AVAILABLE ? '' : '\n  no browser — npx playwright install chromium') +
      (existsSync(CLI) ? '' : '\n  the CLI is not built — yarn build') +
      '\n',
  );
}

/** The CLI half of the deferred adoption, and the outer test's own fixtures. */
let directory;
let config;
let environment;

function rstest(where, arguments_, extra) {
  return new Promise((settle, fail) => {
    const child = spawn(process.execPath, [RSTEST, 'run', '-c', 'rstest.config.mjs', ...arguments_], {
      cwd: join(CASE, where),
      env: { ...process.env, ...extra },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      output += chunk.toString();
    });
    child.on('error', fail);
    child.on('exit', (code) => settle({ code, output }));
  });
}

beforeAll(async () => {
  if (!READY) return;
  directory = await mkdtemp(join(tmpdir(), 'variance-rstest-workflow-'));
  config = join(directory, 'variance.config.json');
  environment = { VARIANCE_CAPTURE_DIRECTORY: join(directory, 'captures') };

  await writeFile(
    config,
    `${JSON.stringify(
      {
        project: 'rstest-case',
        profile: 'chromium',
        viewport: { width: 320, height: 200, deviceScaleFactor: 1, colorScheme: 'light' },
        retention: 'durable',
        subjects: { kind: 'collector', collector: COLLECTOR },
        baselines: { kind: 'directory', root: join(directory, 'baselines') },
        fonts: ['system-ui/400/normal/case-system-stack'],
        report: join(directory, 'run.json'),
        images: join(directory, 'images'),
      },
      null,
      2,
    )}\n`,
    'utf8',
  );
}, 30_000);

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

live('an rstest suite that defers the browser', () => {
  it('captures in jsdom and re-observes what a later CLI process painted', async () => {
    const captured = await rstest('capture', [], environment);
    expect(captured, captured.output).toMatchObject({ code: 0 });

    const cli = { ...process.env, ...environment };
    expect(() =>
      execFileSync(process.execPath, [CLI, 'run', '--config', config, '--exit-zero-on-changes'], {
        cwd: CASE,
        env: cli,
        stdio: 'pipe',
      }),
    ).not.toThrow();

    execFileSync(process.execPath, [CLI, 'accept', '--config', config, '--all'], {
      cwd: CASE,
      env: cli,
      stdio: 'pipe',
    });

    execFileSync(process.execPath, [CLI, 'run', '--config', config], {
      cwd: CASE,
      env: cli,
      stdio: 'pipe',
    });

    const report = JSON.parse(await readFile(join(directory, 'run.json'), 'utf8'));
    expect(report.observations).toHaveLength(1);
    expect(report.observations[0]).toMatchObject({ subject: 'button/save', verdict: 'unchanged' });
  }, 120_000);
});

live('an rstest suite that drives playwright', () => {
  it('refuses an unapproved image, accepts under -u, and then agrees', async () => {
    const baselines = await mkdtemp(join(tmpdir(), 'variance-rstest-e2e-'));
    try {
      // No baseline yet, so the subject is `new` and `assertUnchanged` throws —
      // the failure is the point, and it is Rstest reporting it.
      const unapproved = await rstest('e2e', [], { VA_BASELINES: baselines });
      expect(unapproved.code, unapproved.output).toBe(1);

      // The same flag a reader already uses for snapshots, and the only thing
      // that promotes an image here: absence is not approval.
      const accepted = await rstest('e2e', ['-u'], { VA_BASELINES: baselines });
      expect(accepted, accepted.output).toMatchObject({ code: 0 });

      const unchanged = await rstest('e2e', [], { VA_BASELINES: baselines });
      expect(unchanged, unchanged.output).toMatchObject({ code: 0 });
      expect(unchanged.output).toContain('cart.e2e.test.mjs :: cart > empty');
    } finally {
      await rm(baselines, { recursive: true, force: true });
    }
  }, 180_000);
});
