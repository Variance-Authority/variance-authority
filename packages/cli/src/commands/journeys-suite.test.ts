import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readTestCoverage, testCoverageFile, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import '../bin.fixture.js';
import { main } from '../bin.js';
import { landSuite } from '../index.js';
import { EXIT_CLEAN, EXIT_OPERATOR } from '../exit.js';
import { parseArgs } from '../parse.js';
import { probedModule } from './mainline-fixture.js';

/**
 * `variance journeys <shard.bin>... --suite <name>` in a repository whose root
 * config declares its suites and configures no visual project: the fan-in job
 * of a sharded unit suite. Through `main`, because the config is read, or not,
 * in dispatch.
 */

const cwd = process.cwd();
let root: string;

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'va-journeys-suite-')));
  execFileSync('git', ['init', '--quiet', root]);
  await writeFile(
    join(root, 'variance.config.json'),
    JSON.stringify({
      cacheRoot: '.cache',
      suites: { unit: { kind: 'unit' }, integration: { kind: 'integration' } },
      share: { kind: 'git', mainlines: ['main'] },
    }),
  );
  process.chdir(root);
});

afterEach(async () => {
  process.chdir(cwd);
  await rm(root, { recursive: true, force: true });
});

function shard(files: readonly string[]): TestCoverage {
  return {
    version: 3,
    instrumentation: 'fixture',
    commit: 'c0ffee',
    tests: files.map((file) => ({ file, complete: true, preconditions: [] })),
    modules: [probedModule(files)],
  };
}

describe('`variance journeys` and the project config', () => {
  it('under `--suite`, is not read: the shards land on the suite\'s record, which is read whole, exit 0', async () => {
    const shards = [join(root, 'a.bin'), join(root, 'b.bin')];
    await writeTestCoverage(shards[0]!, shard(['a.test.ts']));
    await writeTestCoverage(shards[1]!, shard(['b.test.ts']));
    let out = '';
    let err = '';

    const code = await main(['journeys', ...shards, '--suite', 'integration'], {
      out: (text) => { out += text; },
      err: (text) => { err += text; },
    });

    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    const record = testCoverageFile(root, { suite: 'integration' });
    expect(existsSync(record)).toBe(true);
    expect(out).toContain(`folded 2 snapshots into ${record}`);
    expect(out).toContain('the whole journal, because a suite reads no project config');
  });

  it('lands a sharded suite for CI with the landing summary alone, never the reading', async () => {
    const shards = [join(root, 'a.bin'), join(root, 'b.bin')];
    await writeTestCoverage(shards[0]!, shard(['a.test.ts']));
    await writeTestCoverage(shards[1]!, shard(['b.test.ts']));

    const said = await landSuite(root, shards, 'integration');

    const record = testCoverageFile(root, { suite: 'integration' });
    expect(existsSync(record)).toBe(true);
    expect(said.split('\n')[0]).toBe(`folded 2 snapshots into ${record}`);
    expect(said).not.toContain('journal');
    expect(said.split('\n').length).toBeLessThanOrEqual(4);
  });

  it('folds two shards over a record as it folds one serial run of the same files over it', async () => {
    // The record a pull request selected from: every file its last run saw.
    const selectedFrom = shard(['a.test.ts', 'b.test.ts', 'c.test.ts']);
    async function landed(name: string, runs: readonly (readonly string[])[]): Promise<TestCoverage> {
      const at = join(root, name);
      execFileSync('git', ['init', '--quiet', at]);
      await writeFile(join(at, 'variance.config.json'), JSON.stringify({ cacheRoot: '.cache', suites: { unit: { kind: 'unit' } } }));
      const record = testCoverageFile(at, { suite: 'unit' });
      await writeTestCoverage(record, selectedFrom);
      const parts = runs.map((files, k) => join(at, `${String(k)}.bin`));
      await Promise.all(runs.map((files, k) => writeTestCoverage(parts[k]!, shard(files))));
      await landSuite(at, parts, 'unit');
      return readTestCoverage(record);
    }

    const sharded = await landed('sharded', [['a.test.ts'], ['b.test.ts']]);
    const serial = await landed('serial', [['a.test.ts', 'b.test.ts']]);

    expect(sharded.tests.map((test) => test.file).sort()).toEqual(['a.test.ts', 'b.test.ts', 'c.test.ts']);
    expect(sharded.tests).toEqual(serial.tests);
    expect(sharded.modules).toEqual(serial.modules);
  });

  it('without `--suite`, is read, and the reading names the report it would narrow to', async () => {
    await writeFile(
      join(root, 'variance.config.json'),
      JSON.stringify({
        cacheRoot: '.cache',
        project: 'web',
        profile: 'chromium',
        viewport: { width: 1280, height: 800 },
        retention: 'ephemeral',
        subjects: { kind: 'list', ids: ['cart/empty'], collector: './collector.mjs' },
        fonts: [],
        report: '.variance/report.json',
      }),
    );
    await writeTestCoverage(testCoverageFile(root), shard(['a.test.ts']));
    let out = '';

    const code = await main(['journeys'], { out: (text) => { out += text; }, err: () => {} });

    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain(`because there is no report at ${join(root, '.variance', 'report.json')}`);
  });

  it('without `--suite` and with no project configured, reads the only suite declared', async () => {
    await writeFile(join(root, 'variance.config.json'), JSON.stringify({ cacheRoot: '.cache', suites: { unit: { kind: 'unit' } } }));
    await writeTestCoverage(testCoverageFile(root, { suite: 'unit' }), shard(['a.test.ts']));
    let out = '';
    let err = '';

    const code = await main(['journeys'], { out: (text) => { out += text; }, err: (text) => { err += text; } });

    expect(err).toBe('');
    expect(code).toBe(EXIT_CLEAN);
    expect(out).toContain('the whole journal');
  });

  it.each([['journeys'], ['share'], ['share', '--publish']])('`%s` with no project configured names the suites to choose from', async (...argv) => {
    let err = '';

    const code = await main(argv, { out: () => {}, err: (text) => { err += text; } });

    expect(code).toBe(EXIT_OPERATOR);
    expect(err).toContain('declares the suites "integration", "unit"');
    expect(err).toContain('pass `--suite <name>`');
    expect(err).not.toContain('profile');
  });

  it('`share` with no project configured publishes the only suite declared', async () => {
    await writeFile(
      join(root, 'variance.config.json'),
      JSON.stringify({ cacheRoot: '.cache', suites: { unit: { kind: 'unit' } }, share: { kind: 'git', mainlines: ['main'] } }),
    );
    let said = '';

    await main(['share', '--publish'], { out: (text) => { said += text; }, err: (text) => { said += text; } });

    expect(said).toContain('the suite "unit" is not given to the share');
  });

  it('is refused by name beside `--suite`, because the root config declares the suite', () => {
    expect(() => parseArgs(['journeys', 'a.bin', '--suite', 'unit', '--config', 'web.json'])).toThrow(
      '`journeys --suite` reads the suite from the root variance.config.json, so it takes no `--config`',
    );
  });
});
