/**
 * A record made at one commit, stated at another commit of the same tree.
 *
 * A pull request's run tests its head merged with the record's commit, a merge
 * no ref holds. When the merge queue's commit lands that same tree, what the
 * run observed is what a run at the landed commit would have: the texts are
 * the texts. The record then names the landed commit where it named the
 * merge, so the mainline can hold it at a commit every clone has. The caller
 * proves the trees equal; this rewrites names and nothing it observed.
 */

import { readFile } from 'node:fs/promises';
import { caseSectionsOf, withCaseSections } from './case-record.js';
import { commitRunsFile, readCommitRuns, writeCommitRuns } from './commit-runs.js';
import { decodeTestCoverage, encodeTestCoverage } from './format.js';
import { writeCoverageBytes } from './record-location.js';

/**
 * State the record at `coverageFile`, made at `from`, at `to`: its coverage's
 * commit, its last run's, and every commit its runs record names that is
 * `from`. A record made at another commit, or at none, is left as it is, and
 * the answer names where it was made.
 */
export async function restateRecord(coverageFile: string, from: string, to: string): Promise<{ readonly restated: true } | { readonly madeAt: string | undefined }> {
  const bytes = await readFile(coverageFile);
  const coverage = decodeTestCoverage(bytes);
  if (coverage.commit !== from) return { madeAt: coverage.commit };
  const sections = caseSectionsOf(bytes);
  const runs = await readCommitRuns(coverageFile);
  const at = (commit: string): string => (commit === from ? to : commit);

  let last = sections.last;
  if (last !== undefined) {
    const run = JSON.parse(Buffer.from(last).toString('utf8')) as { commit?: string; before?: string };
    last = Buffer.from(JSON.stringify({ ...run, ...(run.commit === undefined ? {} : { commit: at(run.commit) }), ...(run.before === undefined ? {} : { before: at(run.before) }) }));
  }
  await writeCoverageBytes(coverageFile, withCaseSections(encodeTestCoverage({ ...coverage, commit: to }), { ...sections, ...(last === undefined ? {} : { last }) }));
  if (runs !== undefined) {
    await writeCommitRuns(commitRunsFile(coverageFile), {
      ...runs,
      ...(runs.commit === undefined ? {} : { commit: at(runs.commit) }),
      ...(runs.over === undefined ? {} : { over: at(runs.over) }),
      ...(runs.standing === undefined ? {} : { standing: runs.standing.map((entry) => ({ ...entry, commit: at(entry.commit) })) }),
    });
  }
  return { restated: true };
}
