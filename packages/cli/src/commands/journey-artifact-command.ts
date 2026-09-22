import {
  finalizeJestJourneys,
  stitchJourneyArtifacts,
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
    return EXIT_CLEAN;
  }

  const result = await stitchJourneyArtifacts(parsed.shards, parsed.into);
  streams.out(
    `journeys: stitched ${result.shards} shards into ${parsed.into} (${result.tests} tests, ${result.modules} modules, ${result.crossings} crossings)\n`,
  );
  return EXIT_CLEAN;
}
