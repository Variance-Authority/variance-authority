/**
 * Read the mainline's record of every shared suite for the checkout here:
 * `node tools/read-mainline.mjs`, as `check.yml`'s `base` job runs it. What
 * each read says goes to stderr; `dir=` and `commit=` go to `$GITHUB_OUTPUT`.
 *
 * `dir` is the cache's read root, which the job hands to every other job:
 * a pointer per suite to the record it read, asked at this checkout's merge
 * base with the mainline. `commit` is the commit the records were made at,
 * which a pull request's head is merged with, or empty when the suites'
 * records were made at different commits, or none was read.
 *
 * The job runs it twice on a pull request: once on GitHub's merge to learn
 * the commit, and again on the head merged with that commit, whose merge base
 * the other jobs then stand on. A job reuses a pointer only when it stands at
 * the merge base the pointer was asked at, or when the record is at or past
 * its own: asked once on GitHub's merge, the pointer would send each job to
 * the line again whenever the head already held the record's commit.
 */

import { appendFileSync } from 'node:fs';
import { mainlineMissed, mainlineRead, suiteBase } from '@variance-authority/cli';
import { cacheRootFor, declaredSuites } from '@variance-authority/sense/test-selection';

const root = process.cwd();
const commits = new Set();
for (const { name, carry } of declaredSuites(root) ?? []) {
  if (carry !== 'share') continue;
  const base = await suiteBase(root, { suite: name });
  if (base.from === 'mainline') {
    console.error(mainlineRead(base.mainline));
    commits.add(base.mainline.commit);
  } else if ('missed' in base && base.missed !== undefined) console.error(mainlineMissed(base.missed));
}
if (commits.size > 1) console.error(`::notice::The mainline's records were made at ${[...commits].join(', ')}, so a pull request's head stays merged with the base tip.`);
const commit = commits.size === 1 ? [...commits][0] : '';
const output = process.env.GITHUB_OUTPUT;
if (output === undefined) {
  console.error('read-mainline: GITHUB_OUTPUT names no file to write dir= and commit= to');
  process.exit(2);
}
appendFileSync(output, `dir=${cacheRootFor(root)}/share/read\ncommit=${commit}\n`);
