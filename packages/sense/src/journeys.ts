/**
 * Layer-2 journeys: each recorded case walked once over the static call graph,
 * so a question about a file can say who reaches its recorded functions, where
 * they go, and which package flows pass through it.
 *
 * The walk is the addon's and is paid before anyone asks: `variance index`
 * prepares the journeys beside the source index, one file per suite, stamped
 * with the recording, the index and the runner's alias table they were made
 * from. Preparing again with none of the three changed keeps the file. A
 * question reads only that file, and a file whose recording or index moved
 * since answers with why it cannot, never with a stale route.
 */

// compass: variance-authority.reach.relations

import { existsSync } from 'node:fs';
import { native, nativeRefusal } from './native.js';
import type { NativeJourneysAnswer, NativeJourneysAsk, NativeJourneysPrepared } from './native-journeys.js';
import { runnerAliases, runnerConfigs, runnerDigest } from './runner-aliases.js';
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

function entry<Name extends 'prepareJourneys' | 'journeysKept' | 'journeysRunnerFiles' | 'journeysFor'>(name: Name) {
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

/** The commit a recording ran at; absent when it names none or does not read, and the walk then reads the tree as it is. */
async function commitOf(coverage: string): Promise<string | undefined> {
  try {
    return await askCoverageFile(coverage, (read) => read.commit);
  } catch {
    return undefined;
  }
}

/** One suite's prepared journeys, or why none were prepared. */
export type PreparedJourneys =
  | { readonly suite?: string; readonly out: string; readonly prepared: NativeJourneysPrepared }
  | { readonly suite?: string; readonly out: string; readonly unprepared: string };

/**
 * Walk each suite's latest recording over the source index at `index` and keep
 * the journeys beside it, unless the kept ones were made from this recording,
 * this index and this runner table.
 */
export async function prepareJourneys(root: string, index: string = sourceIndexPath(root)): Promise<readonly PreparedJourneys[]> {
  const configs = await runnerConfigs(root);
  const prepared: PreparedJourneys[] = [];
  for (const { suite, recording, looked } of recordings(root)) {
    const named = suite === undefined ? {} : { suite };
    const out = journeysPath(index, suite);
    if (recording === undefined) {
      prepared.push({ ...named, out, unprepared: `nothing is recorded at ${looked}` });
      continue;
    }
    // The stamp covers what the kept table was read from as well as what
    // would be read now, so a config removed or an import it dropped moves it.
    const files = configs === undefined ? undefined : [...configs, ...(entry('journeysRunnerFiles')(out) ?? [])];
    const kept = entry('journeysKept')(index, recording, out, files === undefined ? null : runnerDigest(root, files));
    if (kept !== null) {
      prepared.push({ ...named, out, prepared: kept });
      continue;
    }
    const table = configs === undefined ? null : JSON.stringify(await runnerAliases(root, configs));
    const commit = await commitOf(recording.slice(0, -'.cases.bin'.length));
    const made = entry('prepareJourneys')(root, index, recording, commit ?? null, out, table);
    prepared.push(made === null ? { ...named, out, unprepared: 'there is no source index' } : { ...named, out, prepared: made });
  }
  return prepared;
}

/** One suite's answer about the asked files, or why it has none. */
export interface JourneysAround {
  readonly suite?: string;
  readonly answer: NativeJourneysAnswer;
}

/** What each suite's prepared journeys say about `asks`, which are paths from `root` with an optional line. */
export function journeysAround(root: string, asks: readonly NativeJourneysAsk[]): readonly JourneysAround[] {
  const index = sourceIndexPath(root);
  return recordings(root).map(({ suite, recording }) => {
    const named = suite === undefined ? {} : { suite };
    if (recording === undefined) return { ...named, answer: { notPrepared: 'there is no recording to walk', cases: 0, files: [] } };
    return { ...named, answer: entry('journeysFor')(root, index, recording, journeysPath(index, suite), asks.map((ask) => ({ ...ask }))) };
  });
}
