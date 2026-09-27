/**
 * Layer-2 journeys: each recorded case walked once over the static call graph,
 * so a question about a file can say who reaches its recorded functions, where
 * they go, and which package flows pass through it.
 *
 * The walk is the addon's and is paid before anyone asks: `variance index`
 * prepares the journeys beside the source index, one file per suite, stamped
 * with the recording, the index and the runner's alias table they were made
 * from, and with the walk that made them. Preparing again with none of them
 * changed keeps the file. A question reads only that file, and a file whose
 * recording, index or walk moved since answers with why it cannot, never with
 * a stale route.
 */

// compass: variance-authority.reach.relations

import { existsSync } from 'node:fs';
import { native, nativeRefusal } from './native.js';
import type { NativeJourneysAnswer, NativeJourneysAsk, NativeJourneysCommit, NativeJourneysPrepared } from './native-journeys.js';
import type { SourceUpdate } from './published.js';
import { keptRunnerAliases, runnerConfigs, unlistedRunnerAliases, type RunnerAliases } from './runner-aliases.js';
import { sourceIndexPath } from './source-index.js';
import { layeredFiles, repositoryLayers } from './test-selection/cache-layers.js';
import { recordPath } from './test-selection/record-location.js';
import { askCoverageFile } from './test-selection/coverage-file.js';
import { declaredSuites } from './test-selection/suites.js';

export type {
  NativeJourneysAnswer as JourneysAnswer,
  NativeJourneysAsk as JourneysAsk,
  NativeJourneysBlock as JourneysBlock,
  NativeJourneysCall as JourneysCall,
  NativeJourneysFile as JourneysFile,
  NativeJourneysFlow as JourneysFlow,
  NativeJourneysFlows as JourneysFlows,
  NativeJourneysPrepared as JourneysPrepared,
  NativeJourneysRegion as JourneysRegion,
} from './native-journeys.js';

function entry<Name extends 'prepareJourneys' | 'journeysKept' | 'journeysFor'>(name: Name) {
  const scanner = native();
  const call = scanner?.[name];
  if (scanner === undefined || call === undefined) {
    throw new Error(
      `journeys are walked by the native scanner, and ${nativeRefusal() ?? `the scanner that loaded has no \`${name}\`; build it again`}`,
    );
  }
  return call.bind(scanner) as NonNullable<typeof call>;
}

/** Where one suite's journeys are kept beside the index at `index`. */
export function journeysPath(index: string, suite?: string): string {
  return suite === undefined ? `${index}.journeys` : `${index}.${encodeURIComponent(suite)}.journeys`;
}

/** One suite's recording, found the way every reader of a recording finds one: the nearest layer that holds it. */
function recordings(root: string): readonly { readonly suite?: string; readonly recording?: string; readonly looked: string }[] {
  const suites = declaredSuites(root)?.map((suite) => suite.name) ?? [undefined];
  const layers = repositoryLayers(root);
  return suites.map((suite) => {
    const candidates = layeredFiles(layers, `${recordPath(root, suite)}.cases.bin`);
    const recording = candidates.find((candidate) => existsSync(candidate));
    return { ...(suite === undefined ? {} : { suite }), ...(recording === undefined ? {} : { recording }), looked: candidates[0]! };
  });
}

/** The commit a recording ran at, or why there is none: the walk then reads the tree as it is, and says so. */
function commitOf(coverage: string): NativeJourneysCommit {
  try {
    const commit = askCoverageFile(coverage, (read) => read.commit);
    return commit === undefined ? { unread: 'the recording names no commit' } : { commit };
  } catch (error) {
    return { unread: `the recording's commit did not read (${(error instanceof Error ? error.message : String(error)).split('\n')[0]})` };
  }
}

/** Where the runner's alias table is kept beside the index at `index`, shared by every suite. */
function runnerPath(index: string): string {
  return `${index}.runner-aliases.json`;
}

/** One suite's prepared journeys, or why none were prepared. */
export type PreparedJourneys =
  | { readonly suite?: string; readonly out: string; readonly prepared: NativeJourneysPrepared }
  | { readonly suite?: string; readonly out: string; readonly unprepared: string };

/**
 * Walk each suite's latest recording over the source index at `index` and keep
 * the journeys beside it, unless the kept ones were made from this recording,
 * this index, this runner table and this walk. `scanned` is the update that
 * published the index: its listing of the checkout is carried, and git is not
 * asked again; a scan that ran without one lists nothing, and says so.
 */
export async function prepareJourneys(
  root: string,
  index: string = sourceIndexPath(root),
  scanned?: Pick<SourceUpdate, 'listing'>,
): Promise<readonly PreparedJourneys[]> {
  const listing = scanned?.listing;
  const configs = scanned !== undefined && listing === undefined ? undefined : runnerConfigs(root, listing);
  // One table for every suite, read at most once, and not at all when it is kept.
  let table: RunnerAliases | undefined;
  const runner = async () =>
    (table ??= configs === undefined
      ? unlistedRunnerAliases(root, scanned !== undefined ? 'the scan had no listing of the checkout' : 'git could not list the checkout')
      : await keptRunnerAliases(root, configs, runnerPath(index)));
  const walk = listing?.prepareJourneys?.bind(listing) ?? entry('prepareJourneys');
  const prepared: PreparedJourneys[] = [];
  for (const { suite, recording, looked } of recordings(root)) {
    const named = suite === undefined ? {} : { suite };
    const out = journeysPath(index, suite);
    if (recording === undefined) {
      prepared.push({ ...named, out, unprepared: `nothing is recorded at ${looked}` });
      continue;
    }
    const aliases = await runner();
    const kept = entry('journeysKept')(index, recording, out, aliases.digest);
    if (kept !== null) {
      prepared.push({ ...named, out, prepared: kept });
      continue;
    }
    const at = commitOf(recording.slice(0, -'.cases.bin'.length));
    const made = walk(root, index, recording, at, out, JSON.stringify(aliases));
    prepared.push(made === null ? { ...named, out, unprepared: 'there is no source index' } : { ...named, out, prepared: made });
  }
  return prepared;
}

/** One suite's answer about the asked files, or why it has none. */
export interface JourneysAround {
  readonly suite?: string;
  readonly answer: NativeJourneysAnswer;
}

/**
 * What each recorded suite's prepared journeys say about `asks`, which are paths
 * from `root` with an optional line. A suite with no recording has no journeys
 * to speak of and is left out, so nothing recorded answers with no suite.
 */
export function journeysAround(root: string, asks: readonly NativeJourneysAsk[]): readonly JourneysAround[] {
  const index = sourceIndexPath(root);
  return recordings(root).flatMap(({ suite, recording }) => {
    if (recording === undefined) return [];
    const named = suite === undefined ? {} : { suite };
    return [{ ...named, answer: entry('journeysFor')(root, index, recording, journeysPath(index, suite), asks.map((ask) => ({ ...ask }))) }];
  });
}
