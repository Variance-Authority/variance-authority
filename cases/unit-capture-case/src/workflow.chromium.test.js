import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const CASE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(CASE, '../..');
const VITEST = join(ROOT, 'node_modules/vitest/vitest.mjs');
const CLI = join(ROOT, 'packages/cli/dist/bin.js');
const CAPTURE_TEST = join(CASE, 'capture/button.capture.test.mjs');
const CAPTURE_CONFIG = join(CASE, 'capture/vitest.config.mjs');
const COLLECTOR = join(CASE, 'collector/index.mjs');

let directory;
let config;
let environment;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), 'variance-unit-workflow-'));
  const captures = join(directory, 'captures');
  config = join(directory, 'variance.config.json');
  environment = { ...process.env, VARIANCE_CAPTURE_DIRECTORY: captures };

  await writeFile(
    config,
    `${JSON.stringify(
      {
        project: 'unit-capture-case',
        profile: 'chromium',
        viewport: {
          width: 320,
          height: 200,
          deviceScaleFactor: 1,
          colorScheme: 'light',
        },
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

  execFileSync(process.execPath, [VITEST, 'run', '--config', CAPTURE_CONFIG, CAPTURE_TEST], {
    cwd: join(CASE, 'capture'),
    env: environment,
    stdio: 'pipe',
  });
}, 30_000);

afterAll(async () => {
  if (directory) await rm(directory, { recursive: true, force: true });
});

describe('unit capture in one process, browser rendering in another', () => {
  it('records and then re-observes the browserless artifact', () => {
    expect(() =>
      execFileSync(process.execPath, [CLI, 'run', '--config', config, '--exit-zero-on-changes'], {
        cwd: CASE,
        env: environment,
        stdio: 'pipe',
      }),
    ).not.toThrow();

    execFileSync(process.execPath, [CLI, 'accept', '--config', config, '--all'], {
      cwd: CASE,
      env: environment,
      stdio: 'pipe',
    });

    execFileSync(process.execPath, [CLI, 'run', '--config', config], {
      cwd: CASE,
      env: environment,
      stdio: 'pipe',
    });

    return readFile(join(directory, 'run.json'), 'utf8').then((text) => {
      const report = JSON.parse(text);
      expect(report.observations).toHaveLength(1);
      expect(report.observations[0]).toMatchObject({
        subject: 'button/save',
        verdict: 'unchanged',
      });
    });
  }, 60_000);
});
