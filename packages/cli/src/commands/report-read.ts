import { readFile } from 'node:fs/promises';
import { dirname, extname, resolve } from 'node:path';
import type { Config } from '../config.js';
import { mergeReports } from './merge.js';
import { readCliRunReport, type CliRunReport } from './run.js';

/**
 * The report the operator meant: the configured one, or the shards they named.
 *
 * Shared by `report`, `ask`, `adjudicate` and `comment` so a sharded suite gets
 * *one* of each. Having only the first take shard paths would leave the
 * pull-request body reading a single slice while the text output described the
 * suite — two answers about one run, from one binary, differing by which
 * subcommand asked.
 *
 * `embed` is applied per shard, before the merge, because an image path is
 * relative to the report that named it and the merged report has no directory.
 */
export async function reportsFor(
  paths: readonly string[],
  config: Config,
  embed = false,
): Promise<CliRunReport> {
  const named = paths.length === 0 ? [config.report] : paths;
  return mergeReports(
    await Promise.all(
      named.map(async (path) => {
        const report = await readCliRunReport(path);
        return { path, report: embed ? await embedImages(report, dirname(path)) : report };
      }),
    ),
  );
}

const MEDIA: Readonly<Record<string, string>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
};

/**
 * The report with each picture it names carried inside it, as a `data:` URL.
 *
 * For `report --format html --embed-images`: a page that has to be opened where
 * its images are not — a CI artifact viewed in a browser, a file sent to a phone.
 * Only `before`, `diff` and `after` are pictures; `record` is a sidecar and stays
 * a path. A picture that cannot be read keeps its path, so the page shows it as
 * missing where it would have been rather than dropping the subject's slot.
 */
export async function embedImages(report: CliRunReport, dir: string): Promise<CliRunReport> {
  const observations = await Promise.all(
    report.observations.map(async (entry) => {
      if (entry.images === undefined) return entry;
      const images = { ...entry.images };
      for (const side of ['before', 'diff', 'after'] as const) {
        const path = images[side];
        const media = path === undefined ? undefined : MEDIA[extname(path).toLowerCase()];
        if (path === undefined || media === undefined) continue;
        const bytes = await readFile(resolve(dir, path)).catch(() => undefined);
        if (bytes !== undefined) images[side] = `data:${media};base64,${bytes.toString('base64')}`;
      }
      return { ...entry, images };
    }),
  );
  return { ...report, observations };
}
