import {
  caseSectionsAt,
  commitRunsAfter,
  foldCoverageArtifacts,
  landCases,
  lastCaseRunOf,
  openCoverageFile,
  openTestCoverage,
  RecordWithoutCoverage,
  recordOfCases,
  shardsInstall,
  withCaseSections,
  writeCommitRuns,
  writeCoverageBytes,
  type LaidRun,
  type TestCoverageView,
} from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { said } from '../here.js';
import type { LandedJourneys } from './journeys.js';
import { shardRuns } from './land.js';
import { isMissing, messageOf } from './resources.js';
import { stagedLanding } from './staged-landing.js';

/** Combine only the named artifacts, on their stored columns, replacing the output without seeding a checkout baseline. */
export async function mergeJourneyArtifacts(root: string, paths: readonly string[], at: string, progress?: (label: string) => void): Promise<LandedJourneys> {
  progress?.(`reading metadata from ${paths.length} shard records`);
  const read = paths.map((path) => {
    try {
      const opened = openCoverageFile(path);
      try { return { path, coverage: runOf(opened.view) }; }
      finally { opened.close(); }
    } catch (error) {
      if (error instanceof RecordWithoutCoverage) return { path };
      throw new OperatorError(isMissing(error)
        ? `there is no snapshot at ${said(path)}`
        : `the snapshot at ${said(path)} could not be read: ${messageOf(error)}`, { cause: error });
    }
  });
  const measured = read.filter((shard): shard is typeof shard & { coverage: ReturnType<typeof runOf> } => shard.coverage !== undefined);
  const named = read.flatMap(({ path, coverage }) => {
    const commit = coverage?.commit ?? lastCaseRunOf(caseSectionsAt(path))?.commit;
    return commit === undefined ? [] : [{ path, commit }];
  });
  const other = named.find((shard) => shard.commit !== named[0]!.commit);
  if (other !== undefined) throw new OperatorError(
    `${named[0]!.path} and ${other.path} disagree about the commit (\`${named[0]!.commit}\` against ` +
    `\`${other.commit}\`), so they are not shards of one run and cannot be folded into one.`,
  );
  progress?.(`folding coverage from ${measured.length} shard records`);
  let folded: ReturnType<typeof foldCoverageArtifacts> | undefined;
  try { folded = measured.length === 0 ? undefined : foldCoverageArtifacts(measured.map(({ path }) => path)); }
  catch (error) { throw new OperatorError(messageOf(error), { cause: error }); }
  const run = folded === undefined ? undefined : runOf(openTestCoverage(folded.bytes));
  const installed = run === undefined ? undefined : shardsInstall(await Promise.all(measured.map(async ({ path, coverage }) => ({
    tests: coverage, runs: await shardRuns(path),
  }))));
  const runs = run === undefined ? undefined : commitRunsAfter(undefined, undefined, run, installed);
  progress?.(`combining cases from ${paths.length} shards (${folded?.tests ?? 0} observations, ${folded?.modules ?? 0} modules)`);
  const cases = await stagedLanding(at, async (staged, stagedRuns) => {
    // Artifact fan-in uses recorded paths; whether today's checkout holds them
    // is a later question, not a reason to discard downloaded evidence.
    const { landing, sections } = landCases(at, {}, root, read, undefined, undefined, undefined, () => true, true);
    const bytes = folded === undefined ? recordOfCases(sections) : withCaseSections(folded.bytes, sections);
    progress?.(`writing combined record (${Math.ceil(bytes.length / 1024 / 1024)} MiB)`);
    await writeCoverageBytes(staged, bytes);
    if (runs !== undefined) await writeCommitRuns(stagedRuns, runs);
    return { kept: true, runs: runs !== undefined, replaceRuns: true, value: landing };
  });
  return { at, shards: paths.length, observations: folded?.tests ?? 0, modules: folded?.modules ?? 0,
    ...(run?.commit === undefined ? {} : { commit: run.commit }), cases };
}

/** The run metadata a case landing and runs record need; no region crossing is decoded. */
function runOf(view: TestCoverageView): LaidRun & { readonly instrumentation: string } {
  const paths = view.testPath.all();
  const complete = view.testComplete.all();
  const modules = view.modulePath.all();
  const source = view.moduleSource.all();
  return {
    instrumentation: view.instrumentation,
    ...(view.commit === undefined ? {} : { commit: view.commit }),
    tests: Array.from(paths, (file, at) => ({ file: view.string(file), complete: complete[at] === 1 })),
    modules: Array.from(modules, (file, at) => ({ file: view.string(file), sourceDigest: view.string(source[at]!) })),
  };
}
