import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import { declaredSuites, testCoverageFile } from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering, formatCovering } from './covering.js';

// One test file run by two Vitest projects, `plain` and `compiled`, recorded
// through the real seam into a cache of its own.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/twin-projects-vitest');
const source = 'packages/sense/test/fixtures/twin-projects-vitest/src/greet.ts';
const suite = declaredSuites(repository)?.[0]?.name;
const named = suite === undefined ? [] : ['--suite', suite];
let cache: string;
let previous: string | undefined;

beforeAll(async () => {
  cache = await mkdtemp(join(tmpdir(), 'variance-covering-projects-'));
  previous = process.env['VARIANCE_AUTHORITY_CACHE'];
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  await promisify(execFile)(
    process.execPath,
    [resolve(repository, 'node_modules/vitest/vitest.mjs'), 'run', '--config', resolve(fixture, 'vitest.config.ts')],
    { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: testCoverageFile(repository, { suite }) } },
  );
  await updateSourceIndex(repository);
}, 60_000);

afterAll(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await rm(cache, { recursive: true, force: true });
});

it('tells the copies of a case apart by the project that ran each', async () => {
  const flags = readFlags(['--file', source, '--line', '2', '--root', repository, ...named], 'covering', flagsFor('covering'), synopsisFor('covering'));
  const answer = await covering(parseCoveringArgs(flags));
  const text = formatCovering(answer, 'text');

  expect(answer.tests?.map((test) => test.id).sort()).toEqual([
    '|compiled| packages/sense/test/fixtures/twin-projects-vitest/test/greet.case.ts > greets by name',
    '|plain| packages/sense/test/fixtures/twin-projects-vitest/test/greet.case.ts > greets by name',
  ]);
  expect(text).toContain('greets by name [|compiled| packages/sense/test/fixtures/twin-projects-vitest/test/greet.case.ts > greets by name]');
  expect(text).not.toContain('#1');
});
