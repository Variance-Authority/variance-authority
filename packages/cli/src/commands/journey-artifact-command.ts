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
    streams.out(gaps(result));
    return EXIT_CLEAN;
  }

  const result = await stitchJourneyArtifacts(parsed.shards, parsed.into);
  streams.out(
    `journeys: stitched ${result.shards} shards into ${parsed.into} (${result.tests} tests, ${result.modules} modules, ${result.crossings} crossings)\n`,
  );
  streams.out(renumbered(result));
  streams.out(gaps(result));
  return EXIT_CLEAN;
}

/**
 * The files whose regions are coarser than recorded, by name.
 *
 * Two shards can cut one file into different regions, and then a region's
 * number means something different in each. Those crossings are
 * credited to the regions both transforms share. A reader who sees a function
 * select more tests than it should needs to find out why here.
 */
function renumbered(result: JourneyArtifactResult): string {
  const files = result.renumbered ?? [];
  if (files.length === 0) return '';
  const count = files.length === 1 ? '1 file was' : `${files.length} files were`;
  return (
    `journeys: ${count} cut into different regions by different transforms; ` +
    'crossings there are credited to the regions every transform shares:\n' +
    files.map((file) => `  ${file}\n`).join('')
  );
}

/** Everything the artifact could not charge to a case, each named. */
function gaps(result: JourneyArtifactResult): string {
  return silent(result) + unclaimed(result) + unrecorded(result);
}

/**
 * The heads that wrote parts in the run before and none in this one, by name:
 * a service that stopped being reached, or stopped writing. Nothing of it is
 * charged, so a change to what only it ran selects nothing.
 */
function silent(result: JourneyArtifactResult): string {
  const heads = result.silent ?? [];
  if (heads.length === 0) return '';
  const count = heads.length === 1 ? '1 head' : `${heads.length} heads`;
  return (
    `journeys: ${count} wrote parts in the run before and none in this one, so a change to what only they ran selects nothing:\n` +
    heads.map((head) => `  ${head}\n`).join('')
  );
}

/**
 * The part files no case claimed, by name: a process that ran code while no
 * journey a case handed out reached it. Its coverage is charged to nobody, so
 * a change to what only it ran selects nothing.
 */
function unclaimed(result: JourneyArtifactResult): string {
  const files = result.unclaimed ?? [];
  if (files.length === 0) return '';
  const count = files.length === 1 ? '1 part ran' : `${files.length} parts ran`;
  return (
    `journeys: ${count} code under no case's journey id, so a change to what only they ran selects nothing; ` +
    'the hop in front of each has to forward the id:\n' +
    files.map((file) => `  ${file}\n`).join('')
  );
}

/**
 * The modules a case ran that no record holds, by name. What ran there has no
 * region to be credited to, so a change to them selects nothing.
 */
function unrecorded(result: JourneyArtifactResult): string {
  const modules = result.unrecorded ?? [];
  if (modules.length === 0) return '';
  const count = modules.length === 1 ? '1 module' : `${modules.length} modules`;
  return (
    `journeys: cases ran ${count} no record holds, so a change there selects nothing:\n` +
    modules.map((module) => `  ${module}\n`).join('')
  );
}
