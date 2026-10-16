import type { Config } from '../config.js';
import { writePieces } from '../json-pieces.js';
import { htmlPage } from './report.js';
import { carrying } from './report-html-pictures.js';
import { reportWithPictures, reportsFor } from './report-read.js';
import type { CliRunReport } from './run.js';

/**
 * `variance report --format html`: the page, written as it is made.
 *
 * The page goes to standard output a batch at a time, waiting for the reader
 * between batches, because a page carrying a run's pictures is larger than any
 * one string can be and larger than it is worth holding. With `--embed-images`
 * the pictures the page shows are located first, so the page can give every
 * `<img>` its size, and are read one at a time as the page reaches them.
 *
 * Returns the report, because the artifact decides the exit code.
 */
export async function writeReportPage(
  options: {
    readonly paths: readonly string[];
    readonly config: Config;
    readonly embedImages: boolean;
    readonly subject?: string;
  },
  streams: { out(text: string): void; drained?(): Promise<boolean> },
): Promise<CliRunReport> {
  const subject = options.subject !== undefined ? { subject: options.subject } : {};
  if (!options.embedImages) {
    const report = await reportsFor(options.paths, options.config);
    await writePieces(htmlPage({ report, ...subject }), streams);
    return report;
  }
  const { report, pictures } = await reportWithPictures(options.paths, options.config);
  await writePieces(htmlPage({ report, placement: carrying(pictures), ...subject }), streams);
  return report;
}
