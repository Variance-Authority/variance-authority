import type { CostsSubject, SubjectCost } from '@variance-authority/mcp/tools';
import type { Config } from '../config.js';
import { OperatorError } from '../exit.js';
import { mainlineCosts } from './costs.js';
import { reportsFor } from './report-read.js';
import type { CliRunReport } from './run-report.js';
import { describeDistance, type Here } from './share.js';

/**
 * What `ask costs` reads: the reports the reader named, or the mainline's
 * published costs.
 *
 * The mainline's by default, because they are the whole suite: a build that
 * publishes composes every shard's times, and a local run is usually a slice of
 * the suite chosen by a change. Named reports are read instead when a reader
 * names them, so the times of a run they just made are one flag away.
 *
 * Never the configured report as a fallback. A reader asking where the suite
 * spends its time and answered from whichever run happened to be last on this
 * machine would be told about a slice as though it were the suite; so when the
 * mainline has none the answer says so and names the flag that reads a report.
 */
export async function costsSubject(config: Config, reports: readonly string[], here: Here = {}): Promise<CostsSubject> {
  if (reports.length > 0) {
    const report = await reportsFor(reports, config);
    return { from: `The report${reports.length === 1 ? '' : 's'} ${reports.join(', ')}`, subjects: subjectsOf(report) };
  }
  const found = await mainlineCosts(config, here);
  if (found === null) {
    throw new OperatorError(
      'no subject costs on the mainline: a build publishes them with `variance share --publish`. ' +
        'Name a report to read its own, as `variance ask costs <report>`.',
    );
  }
  const subjects = [...found.costs].map(([subject, ms]): SubjectCost => {
    const file = found.files?.get(subject);
    return file === undefined ? { subject, ms } : { subject, ms, file };
  });
  return {
    from: `Mainline ${found.mainline} at ${found.commit.slice(0, 12)}, ${describeDistance(found.distance)}`,
    subjects,
  };
}

function subjectsOf(report: Pick<CliRunReport, 'observations'>): readonly SubjectCost[] {
  return report.observations.flatMap((observation): SubjectCost[] => {
    if (observation.costMs === undefined) return [];
    const ms = Math.round(observation.costMs);
    return [observation.declaredIn === undefined ? { subject: observation.subject, ms } : { subject: observation.subject, ms, file: observation.declaredIn }];
  });
}
