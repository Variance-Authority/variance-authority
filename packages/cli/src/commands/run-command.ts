import type { Config } from '../config.js';
import { reported, type ExitCode } from '../exit.js';
import { said } from '../here.js';
import type { Parsed } from '../parse.js';
import { rendererFor } from '../renderer.js';
import { costsToPlace, publishedCostsLine } from './costs.js';
import { withLiveIgnores } from './ignores.js';
import { pruneWhenDueLines } from './prune-cache.js';
import { renderCacheLine, sweepRenders } from './renders.js';
import { formatReport } from './report.js';
import { run } from './run.js';
import { affectedProjects } from './changes.js';
import { collectorPath, loadCollector, planFor } from './collector.js';
import { historyFor, recordedJourneys, storeFor, suiteJourney, writeArtifactToDisk } from './resources.js';
import { identityOf } from './history.js';
import { narrowingFor } from './narrowing.js';
import { relationsFor, scanSourceDirs } from './source-graph.js';
import { writeCliRunReport } from './run-report.js';
import { suiteIgnore } from './select-before.js';
import { publishedLine } from './share.js';
import { refiningRecord } from './suite-record.js';
import { writeSuitePart } from './suite-part.js';

/**
 * `variance run`, as the binary runs it: the collector, the store and the history
 * resolved from the config and the flags, the run, then what it shares and sweeps.
 *
 * A module of its own so that only `run` loads the renderer, the store and the
 * history: the dispatcher imports it when the command is `run`.
 */
export async function runCommand(
  parsed: Extract<Parsed, { command: 'run' }>,
  config: Config,
  streams: { out(text: string): void; err(text: string): void },
): Promise<ExitCode> {
  const effective: Config =
    parsed.profile === undefined ? config : { ...config, profile: parsed.profile };
  const plan = await planFor(effective);
  const scanRelations = async (dirs: readonly string[]) =>
    relationsFor(process.cwd(), dirs, effective.source?.taints, effective.before);

  const collector = await loadCollector(collectorPath(effective.subjects), {
    config: withLiveIgnores(effective, new Date().toISOString()),
    ...(plan !== undefined ? { plan } : {}),
  });

  // Resolved here, from the flags and the process environment, so that `run`
  // itself stays free of both — it is handed an identity or it is not, and a
  // test can hand it one without setting environment variables that outlive
  // the test.
  const history = await historyFor(effective);

  // One fetch for both verbs when they name the same ref, and `--since`
  // implies `--against` wherever a graph is configured: the walk has already
  // happened by then, and a run that narrowed itself and could not say why is
  // the one shape this is worth avoiding.
  const narrowing = await narrowingFor(
    {
      ...(parsed.since !== undefined ? { since: parsed.since } : {}),
      ...(parsed.against !== undefined ? { against: parsed.against } : {}),
      relations: effective.source?.relations === true,
      ...(parsed.suite !== undefined ? { suite: parsed.suite } : {}),
    },
    effective.source?.dirs ?? [],
  );

  const identity = identityOf(parsed, process.env);

  const ignore = await suiteIgnore(process.cwd(), parsed.suite);

  try {
    const report = await run({
      config: effective,
      ...(ignore !== undefined ? { ignore } : {}),
      ...(parsed.subjects !== undefined ? { subjects: parsed.subjects } : {}),
      ...(parsed.shard !== undefined ? { shard: parsed.shard } : {}),
      ...(await costsToPlace(effective)),
      ...(parsed.intent !== undefined ? { intent: parsed.intent } : {}),
      ...(parsed.flakes ? { flakes: true } : {}),
      ...(identity !== undefined ? { identity } : {}),
      ...narrowing,
      deps: {
        collector,
        store: await storeFor(effective),
        renderer: () => rendererFor(effective),
        now: () => new Date().toISOString(),
        elapsed: () => performance.now(),
        writeArtifact: writeArtifactToDisk,
        writeReport: writeCliRunReport,
        writeSuitePart,
        scanSource: async (dirs) => scanSourceDirs(process.cwd(), dirs),
        scanRelations,
        // A suite with no `source` is read over the checkout, as `variance select` reads it.
        readJourney: async (diff, relations) =>
          suiteJourney(process.cwd(), diff, relations, parsed.suite, async () => scanRelations(effective.source?.dirs ?? ['.'])),
        readJourneys: async (subjects) => {
          const at = await refiningRecord(process.cwd(), parsed.suite);
          return at === undefined ? undefined : recordedJourneys(process.cwd(), subjects, at);
        },
        ...(effective.source?.changes === undefined
          ? {}
          : {
              changedProjects: async (base) =>
                (
                  await affectedProjects({
                    source: effective.source!.changes!,
                    base,
                    cwd: process.cwd(),
                  })
                ).dirs,
            }),
        ...(history !== undefined ? { history } : {}),
      },
    });

    // After the report is on disk and before the exit code is decided:
    // publishing is the last thing a run does for somebody else, and the
    // first thing that must not change what this run concluded.
    const shared =
      (await publishedLine(effective, report, effective.report)) + (await publishedCostsLine(effective, report));

    // Last, for the same reason: the cache is regenerable, so nothing here
    // reaches a verdict. Every run prunes, because the operator whose disk
    // fills is never the one who knew to prune.
    const renders = renderCacheLine(await sweepRenders(effective)) + (await pruneWhenDueLines(effective));

    streams.out(
      `${formatReport({ report, format: 'text' })}\n\nreport: ${said(effective.report)}\n${shared}${renders}`,
    );
    return reported(report, parsed.exitZeroOnChanges, streams);
  } finally {
    await collector.close();
  }
}
