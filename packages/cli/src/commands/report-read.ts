import { dirname } from 'node:path';
import type { Config } from '../config.js';
import { OperatorError } from '../exit.js';
import { mergeReports } from './merge.js';
import { locatePictures, type Picture, type Pictures } from './report-html-pictures.js';
import { readCliRunReport, type CliRunReport } from './run-report.js';
import { refuseMissingShards } from './suite-part.js';

/**
 * The configured report is not on disk: no run has written it in this checkout.
 *
 * A refusal rather than an `ENOENT` stack, for the reason `accept` gives: the
 * state of a working directory is not a defect in this tool. It carries the
 * configuration because one caller has somewhere else to look. `ask` reads the
 * share's record in its place; `report`, `adjudicate`, `comment` and `push`
 * refuse, because a gate that read CI's record would pass or fail a run this
 * checkout never made.
 */
export class AbsentReport extends OperatorError {
  readonly config: Config;

  constructor(config: Config, options?: ErrorOptions) {
    super(
      `there is no run report at ${config.report}, which is where \`report\` in your configuration points; ` +
        '`variance run` writes it there',
      options,
    );
    this.config = config;
  }
}

/**
 * The report the operator meant: the configured one, or the shards they named.
 *
 * Shared by `report`, `ask`, `adjudicate` and `comment` so a sharded suite gets
 * *one* of each. Having only the first take shard paths would leave the
 * pull-request body reading a single slice while the text output described the
 * suite — two answers about one run, from one binary, differing by which
 * subcommand asked.
 */
export async function reportsFor(paths: readonly string[], config: Config): Promise<CliRunReport> {
  return mergeReports(await shardsOf(paths, config));
}

/**
 * The report, with the pictures its page shows located, for a page that carries
 * them: `report --format html --embed-images`.
 *
 * Located per shard, before the merge, because an image path is relative to the
 * report that named it and the merged report has no directory.
 */
export async function reportWithPictures(
  paths: readonly string[],
  config: Config,
): Promise<{ report: CliRunReport; pictures: Pictures }> {
  const pictures = new Map<string, Picture>();
  const located = [];
  for (const shard of await shardsOf(paths, config)) {
    located.push({ ...shard, report: await locatePictures(shard.report, dirname(shard.path), pictures) });
  }
  return { report: mergeReports(located), pictures };
}

async function shardsOf(
  paths: readonly string[],
  config: Config,
): Promise<{ path: string; report: CliRunReport }[]> {
  const named = paths.length === 0 ? [config.report] : paths;
  const shards = await Promise.all(
    named.map(async (path) => {
      const report = await readCliRunReport(path).catch((error: unknown) => {
        if ((error as NodeJS.ErrnoException | null)?.code !== 'ENOENT') throw error;
        // A shard named and not there is a run that did not happen, as the
        // configured one is: an artifact that never uploaded, or a glob that
        // matched nothing and reached here as written.
        throw paths.length === 0
          ? new AbsentReport(config, { cause: error })
          : new OperatorError(`${path} is not there: no run wrote it.`, { cause: error });
      });
      return { path, report };
    }),
  );
  // Shards named are the suite, and a suite with a shard missing did not
  // happen: its subjects would read as ones no shard observed.
  if (paths.length > 0) await refuseMissingShards(paths);
  return shards;
}
