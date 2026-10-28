import { randomUUID } from 'node:crypto';
import { linkSync, rmSync } from 'node:fs';
import { codeUnitOrder } from '@variance-authority/core/segment';
import {
  combineRecords,
  finalizeJestJourneys,
  recordStorageAt,
  stitchJourneyArtifacts,
  type CombinedRecord,
  type JourneyArtifactResult,
} from '@variance-authority/sense/test-selection';
import { EXIT_CLEAN, OperatorError, type ExitCode } from '../exit.js';
import type { Parsed } from '../parse.js';
import { uncheckedReads } from './journeys.js';
import { messageOf } from './resources.js';

type JourneyArtifactCommand = Extract<
  Parsed,
  { command: 'journeys'; operation: 'finalize' | 'stitch' | 'combine' | 'inspect' }
>;

/** Finalize journals, stitch journey artifacts, combine shard records, or inspect their storage. */
export async function runJourneyArtifactCommand(
  parsed: JourneyArtifactCommand,
  streams: { out(text: string): void },
): Promise<ExitCode> {
  if (parsed.operation === 'inspect') {
    try {
      const storage = recordStorageAt(parsed.record);
      const sections = [...storage.sections].sort((left, right) => right.bytes - left.bytes || codeUnitOrder(left.name, right.name));
      const result = { record: parsed.record, ...storage, sections };
      streams.out(parsed.format === 'json' ? `${JSON.stringify(result, null, 2)}\n` :
        `${parsed.record}: ${storage.bytes} bytes, format ${storage.format}\n` +
        `${storage.overheadBytes} bytes outside sections (header and padding)\n` +
        sections.map((section) => `${section.name}: ${section.bytes} bytes, ${section.rows} storage elements of width ${section.width}${section.packed ? ', packed' : ''}\n`).join(''));
      return EXIT_CLEAN;
    } catch (error) {
      throw new OperatorError(messageOf(error), { cause: error });
    }
  }
  if (parsed.operation === 'combine') {
    // A combine writes a record of its own shards and nothing else. Over a
    // record that is there it would discard that record, and over a shard the
    // shard: landing over a record is the reading's job. The record is written
    // beside `--into` and linked to it, which fails when anything is there by
    // then, so nothing made after the command started is written over.
    const staged = `${parsed.into}.${process.pid}-${randomUUID()}.tmp`;
    let result: CombinedRecord;
    try {
      try {
        result = combineRecords(parsed.shards, staged, process.cwd());
      } catch (error) {
        throw new OperatorError(messageOf(error), { cause: error });
      }
      try {
        linkSync(staged, parsed.into);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        throw new OperatorError(
          `${parsed.into} is already there, and \`journeys combine\` writes a new record. ` +
            'To land the shards over it, run `variance journeys <shards> --into <record>`; ' +
            'to combine, name a path nothing is at yet.',
          { cause: error },
        );
      }
    } finally {
      rmSync(staged, { force: true });
    }
    streams.out(`${combinedLine(result, parsed.into)}\n`);
    if (result.unchecked.length > 0) streams.out(`journeys: ${uncheckedReads(result.unchecked)}\n`);
    streams.out(renumbered(result));
    return EXIT_CLEAN;
  }

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

/** What `journeys combine` wrote, in one line. */
function combinedLine(result: CombinedRecord, into: string): string {
  const cases = result.cases == null ? '' : `, ${result.cases} cases`;
  const commit = result.commit == null ? '' : `, recorded at ${result.commit.slice(0, 12)}`;
  return (
    `journeys: combined ${result.shards.length} records into ${into} ` +
    `(${result.tests} tests, ${result.modules} modules, ${result.crossings} crossings${cases}${commit})`
  );
}

/**
 * The files whose regions are coarser than recorded, by name.
 *
 * Two shards can cut one file into different regions, and then a region's
 * number means something different in each. Those crossings are
 * credited to the regions both transforms share. A reader who sees a function
 * select more tests than it should needs to find out why here.
 */
function renumbered(result: Pick<JourneyArtifactResult, 'renumbered'>): string {
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
