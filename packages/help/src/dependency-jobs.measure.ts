import { afterAll, expect, it } from 'vitest';
import { JOBS, PACKAGES } from './dependency-jobs.js';
import { workspaceOf } from './dependency-jobs-fixture.js';
import { queryDependencyLexicon } from './dependency-lexicon.js';

// compass: variance-authority.report.agent-surface

/**
 * Described jobs against packages as they publish themselves. A count gates: how
 * many of the jobs reach the package that should answer them, and how many have
 * it first. Both are printed, so a change to the ranking moves a number a
 * reviewer can read.
 */

const before = process.env['VARIANCE_AUTHORITY_CACHE'];
afterAll(() => {
  if (before === undefined) delete process.env['VARIANCE_AUTHORITY_CACHE'];
  else process.env['VARIANCE_AUTHORITY_CACHE'] = before;
});

/** Jobs whose package must be among the first this many answers. */
const TOP = 3;

it('reaches the package that should answer a described job', async () => {
  expect(JOBS.length).toBeGreaterThanOrEqual(20);
  const root = await workspaceOf(PACKAGES, PACKAGES.map((item) => item.name));
  let reached = 0;
  let first = 0;
  const missed: string[] = [];
  for (const { job, expects } of JOBS) {
    const packages = (queryDependencyLexicon(root, job)?.described ?? []).map((hit) => hit.package);
    if (packages.slice(0, TOP).includes(expects)) reached += 1;
    else missed.push(`${job} -> ${expects}, got ${packages.slice(0, TOP).join(', ') || 'nothing'}`);
    if (packages[0] === expects) first += 1;
  }
  console.log(`described jobs: ${reached}/${JOBS.length} reach the expected package in the first ${TOP}; ${first}/${JOBS.length} have it first`);
  expect(missed).toEqual([]);
  expect(first).toBeGreaterThanOrEqual(Math.ceil(JOBS.length * 0.8));
}, 120_000);
