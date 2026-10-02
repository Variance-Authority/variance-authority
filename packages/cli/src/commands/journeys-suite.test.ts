import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testCoverageFile, writeTestCoverage, type TestCoverage } from '@variance-authority/sense/test-selection';
import { main } from '../bin.js';
import { EXIT_CLEAN } from '../exit.js';
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

describe('`variance journeys <shard.bin>... --suite` with no project config', () => {
  it('lands the shards on the suite\'s record and reads it whole, exit 0', async () => {
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
    expect(out).toContain('the whole journal, because `--suite` reads no project config');
  });

  it('takes no `--config`, because the root config declares the suite', () => {
    expect(() => parseArgs(['journeys', 'a.bin', '--suite', 'unit', '--config', 'web.json'])).toThrow(
      '`journeys --suite` reads the suite from the root variance.config.json, so it takes no `--config`',
    );
  });
});
