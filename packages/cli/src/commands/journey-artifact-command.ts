import {
  finalizeJestJourneys,
  stitchJourneyArtifacts,
  type JourneyArtifactResult,
} from '@variance-authority/sense/test-selection';
import { EXIT_CLEAN, type ExitCode } from '../exit.js';
import type { Parsed } from '../parse.js';

type JourneyArtifactCommand = Extract<
  Parsed,
  { command: 'journeys'; operation: 'finalize' | 'stitch' }
>;

/** Finalize one runner's journals or stitch the artifacts from several CI shards. */
export async function runJourneyArtifactCommand(
  parsed: JourneyArtifactCommand,
  streams: { out(text: string): void },
): Promise<ExitCode> {
  if (parsed.operation === 'finalize') {
    const result = await finalizeJestJourneys(parsed.journeyFile);
    streams.out(
      `journeys: wrote ${parsed.journeyFile} (${result.tests} tests, ${result.modules} modules, ${result.crossings} crossings)\n`,
    );
    streams.out(renumbered(result));
    return EXIT_CLEAN;
  }

  const result = await stitchJourneyArtifacts(parsed.shards, parsed.into);
  streams.out(
    `journeys: stitched ${result.shards} shards into ${parsed.into} (${result.tests} tests, ${result.modules} modules, ${result.crossings} crossings)\n`,
  );
  streams.out(renumbered(result));
  return EXIT_CLEAN;
}

/**
 * The files whose regions are coarser than recorded, by name.
 *
 * Two transforms of one file can cut it into different regions, and then a
 * region's number means something different in each. Those crossings are
 * credited to the regions both transforms share. A reader who sees a function
 * select more tests than it should needs to find out why here.
 */
function renumbered(result: JourneyArtifactResult): string {
  const files = result.renumbered;
  if (files.length === 0) return '';
  const count = files.length === 1 ? '1 file was' : `${files.length} files were`;
  return (
    `journeys: ${count} cut into different regions by different transforms; ` +
    'crossings there are credited to the regions every transform shares:\n' +
    files.map((file) => `  ${file}\n`).join('')
  );
}
