import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { InstrumentMode } from '../instrument/index.js';
import { native, nativeRefusal, type NativeJourneyModule, type NativeScanner } from '../native.js';
import { NO_LINE } from './written-lines.js';
import { deriveModules } from './captured-modules.js';
import type { CapturedModule } from './instrumented-modules.js';

const MANIFEST = 'run.json';
const CASES = 'cases';

interface PendingJourneyRun {
  readonly version: 2;
  readonly root: string;
  /** The recipe the run's probes were placed by; absent for the default. */
  readonly mode?: InstrumentMode;
  /** Directories of part frames written beyond a fence; absent in a run that has none. */
  readonly parts?: readonly string[];
}

/**
 * What finalizing or stitching a journey artifact wrote, as counts, and what
 * it could not charge to a case, by name. `passes` comes from a finalize and
 * `shards` from a stitch; each is absent from the other. The names are the
 * ones the artifact carries, which `journeyGaps` reads back.
 */
export interface JourneyArtifactResult {
  readonly tests: number;
  readonly modules: number;
  readonly crossings: number;
  readonly passes?: number;
  readonly shards?: number;
  /**
   * Files two shards cut into different regions. Their crossings are credited
   * to the regions every shard shares, which is coarser than either recorded
   * and never misses a case that ran a changed line. Absent from a finalize:
   * one run cuts each module once.
   */
  readonly renumbered?: readonly string[];
  /**
   * Modules a case ran that no record holds. What ran there is in no region,
   * so a change to them selects nothing. Absent from a stitch of a shard that
   * does not carry them.
   */
  readonly unrecorded?: readonly string[];
  /**
   * Part files that ran code under no journey a case handed out. What they
   * ran is charged to no case, so a change there selects nothing.
   */
  readonly unclaimed?: readonly string[];
  /**
   * Heads that wrote parts in the run before and none in this one: the
   * artifact the finalize replaced is the run before. Absent when there was
   * none to compare with, which is not a finding.
   */
  readonly silent?: readonly string[];
}

/** The retryable material Jest leaves for a post-run finalizer. */
export function pendingJourneyDirectory(journeyFile: string): string {
  return `${journeyFile}.pending`;
}

/** Seal one Jest run without folding its journals in the reporter lifecycle. */
export async function stageJestJourneys(
  journeyFile: string,
  cases: string,
  runDirectory: string,
  manifest: PendingJourneyRun,
): Promise<void> {
  const pending = pendingJourneyDirectory(journeyFile);
  const temporary = `${pending}.tmp-${process.pid}-${randomUUID()}`;
  await mkdir(cases, { recursive: true });
  await mkdir(temporary, { recursive: true });
  await rename(cases, resolve(temporary, CASES));
  await writeFile(resolve(temporary, MANIFEST), JSON.stringify(manifest), 'utf8');
  await rm(pending, { recursive: true, force: true });
  await rename(temporary, pending);
  await rm(runDirectory, { recursive: true, force: true });
}

/** Fold a sealed Jest run after Jest has already reported its result. */
export async function finalizeJestJourneys(journeyFile: string): Promise<JourneyArtifactResult> {
  const output = resolve(journeyFile);
  const pending = pendingJourneyDirectory(output);
  const manifest = JSON.parse(await readFile(resolve(pending, MANIFEST), 'utf8')) as PendingJourneyRun;
  if (manifest.version !== 2) {
    throw new Error(`not a pending Variance journey run: ${pending}`);
  }
  const cases = resolve(pending, CASES);
  const scanner = native();
  const ids = scanner?.journeyModuleIds;
  const foldTo = scanner?.foldJourneyTo;
  if (ids === undefined || foldTo === undefined) {
    throw new Error(
      `finalizing journey coverage requires the Sense native addon: ${whyAbsent(ids === undefined ? 'journeyModuleIds' : 'foldJourneyTo')}`,
    );
  }
  const parts = [...manifest.parts ?? []];
  const modules = await deriveModules(manifest.root, ids(cases, manifest.root, parts), manifest.mode);
  const result = foldTo(cases, manifest.root, [...modules.values()].map(nativeModule), output, undefined, parts);
  await rm(pending, { recursive: true, force: true });
  return result;
}

/** Assemble downloaded shard artifacts without expanding their crossing relation in JavaScript. */
export async function stitchJourneyArtifacts(
  files: readonly string[],
  journeyFile: string,
): Promise<JourneyArtifactResult> {
  const inputs = files.map((file) => resolve(file));
  const scanner = native();
  const stitchTo = scanner?.stitchJourneysTo;
  if (stitchTo === undefined) {
    throw new Error(
      `stitching journey coverage requires the Sense native addon: ${whyAbsent('stitchJourneysTo')}`,
    );
  }
  return stitchTo(inputs, resolve(journeyFile));
}

/** A module cut again from the checkout, as the native fold reads it. */
export function nativeModule(module: CapturedModule): NativeJourneyModule {
  return {
    id: module.id,
    file: module.file,
    blocks: module.blocks.map((block) => ({
      kind: block.kind,
      name: block.name,
      path: block.path,
      startLine: block.startLine ?? NO_LINE,
      endLine: block.endLine ?? NO_LINE,
      source: block.source,
    })),
  };
}

/** What stopped the addon loading, or which export the addon that did load lacks. */
function whyAbsent(entry: keyof NativeScanner): string {
  return nativeRefusal() ?? `the loaded addon has no \`${entry}\``;
}
