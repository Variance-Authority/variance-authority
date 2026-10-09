import { execFile } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { afterAll, expect, it } from 'vitest';
import { updateSourceIndex } from '@variance-authority/sense';
import { declaredSuites, testCoverageFile } from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { parseCoveringArgs } from '../covering-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { covering, formatCovering } from './covering.js';

// One test file run by two Vitest projects, `plain` and `compiled`, recorded
// through the real seam into a cache of its own for each run.
const here = dirname(fileURLToPath(import.meta.url));
const repository = resolve(here, '../../../..');
const fixture = resolve(repository, 'packages/sense/test/fixtures/twin-projects-vitest');
const source = 'packages/sense/test/fixtures/twin-projects-vitest/src/greet.ts';
const test = 'packages/sense/test/fixtures/twin-projects-vitest/test/greet.case.ts';
const suite = declaredSuites(repository)?.[0]?.name;
const named = suite === undefined ? [] : ['--suite', suite];
const caches: string[] = [];
const previous = process.env['VARIANCE_AUTHORITY_CACHE'];

afterAll(async () => {
  if (previous === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = previous;
  await Promise.all(caches.map((cache) => rm(cache, { recursive: true, force: true })));
});

/** Records one Vitest run with `args` and asks what covers the greeting. */
async function coveringAfter(args: readonly string[]) {
  const cache = await mkdtemp(join(tmpdir(), 'variance-covering-projects-'));
  caches.push(cache);
  process.env['VARIANCE_AUTHORITY_CACHE'] = cache;
  await promisify(execFile)(
    process.execPath,
    [resolve(repository, 'node_modules/vitest/vitest.mjs'), 'run', '--config', resolve(fixture, 'vitest.config.ts'), ...args],
    { cwd: fixture, env: { ...process.env, VARIANCE_AUTHORITY_COVERAGE: testCoverageFile(repository, { suite }) } },
  );
  await updateSourceIndex(repository);
  const flags = readFlags(['--file', source, '--line', '2', '--root', repository, ...named], 'covering', flagsFor('covering'), synopsisFor('covering'));
  return covering(parseCoveringArgs(flags));
}

it('tells the copies of a case apart by the project that ran each', async () => {
  const answer = await coveringAfter([]);
  const text = formatCovering(answer, 'text');

  expect(answer.tests?.map((covered) => covered.id).sort()).toEqual([
    `|compiled| ${test} > greets by name`,
    `|plain| ${test} > greets by name`,
  ]);
  expect(text).toContain(`greets by name [|compiled| ${test} > greets by name]`);
  expect(text).not.toContain('#1');
}, 60_000);

it('names a case the same whether the run took every project or one', async () => {
  const answer = await coveringAfter(['--project', 'plain']);

  expect(answer.tests?.map((covered) => covered.id)).toEqual([`|plain| ${test} > greets by name`]);
}, 60_000);
