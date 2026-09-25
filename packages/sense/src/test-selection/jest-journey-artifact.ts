import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { native, nativeRefusal, type NativeScanner } from '../native.js';

const MANIFEST = 'run.json';
const CASES = 'cases';

interface PendingJourneyRun {
  readonly version: 1;
  readonly root: string;
  readonly stores: readonly string[];
  readonly instrumentation: string;
  /** Directories of part frames written beyond a fence; absent in a run that has none. */
  readonly parts?: readonly string[];
  /** Where the inventories those parts name are kept. */
  readonly partStores?: readonly string[];
}

/**
 * What finalizing or stitching a journey artifact wrote, as counts. `passes`
 * comes from a finalize and `shards` from a stitch; each is absent from the
 * other.
 */
export interface JourneyArtifactResult {
  readonly tests: number;
  readonly modules: number;
  readonly crossings: number;
  readonly passes?: number;
  readonly shards?: number;
  /**
   * Files different transforms cut into different regions. Their crossings are
   * credited to the regions every transform shares, which is coarser than
   * either build recorded and never misses a case that ran a changed line.
   */
  readonly renumbered: readonly string[];
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
  if (manifest.version !== 1 || !Array.isArray(manifest.stores)) {
    throw new Error(`not a pending Variance journey run: ${pending}`);
  }
  const cases = resolve(pending, CASES);
  const scanner = native();
  const foldTo = scanner?.foldJourneyTo;
  if (foldTo === undefined) {
    throw new Error(
      `finalizing journey coverage requires the Sense native addon: ${whyAbsent('foldJourneyTo')}`,
    );
  }
  const result = foldTo(
    cases,
    manifest.root,
    [...manifest.stores],
    manifest.instrumentation,
    output,
    undefined,
    [...manifest.parts ?? []],
    [...manifest.partStores ?? []],
  );
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

/** What stopped the addon loading, or which export the addon that did load lacks. */
function whyAbsent(entry: keyof NativeScanner): string {
  return nativeRefusal() ?? `the loaded addon has no \`${entry}\``;
}
