import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import type { Config } from './config.js';
import { loadConfig } from './config-load.js';
import { EXIT_CLEAN, EXIT_OPERATOR, EXIT_REVIEW, OperatorError, exitFor, type ExitCode } from './exit.js';
import {
  collectorPath,
  loadCollector,
  planFor,
  affectedProjects,
  historyFor,
  identityOf,
  relationsFor,
  run,
  journeyAgainst,
  narrowingFor,
  recordedJourneys,
  scanSourceDirs,
  storeFor,
  writeArtifactToDisk,
  writeCliRunReport,
} from './commands/run.js';
import { renderCacheLine, sweepRenders } from './commands/renders.js';
import { pruneWhenDueLines } from './commands/prune-cache.js';
import { ask, costsSubject } from './commands/ask.js';
import { decisionsSubject } from './commands/ask-decisions.js';
import { said } from './here.js';
import { formatReport } from './commands/report.js';
import {
  adjudicateReport,
  exitForAdjudication,
  formatAdjudication,
  readClaims,
} from './commands/adjudicate.js';
import { withLiveIgnores } from './commands/ignores.js';
import { reportsFor } from './commands/report-read.js';
import { costsToPlace, publishedCostsLine } from './commands/costs.js';
import { accept, formatAcceptance, readCandidate, reportToPromoteFrom } from './commands/accept.js';
import { writeAcceptMessage } from './commands/accept-message.js';
import { changelog, changelogStoreFor, formatChangelog } from './commands/changelog.js';
import { formatRemoteChangelog, readRemoteChangelog } from './commands/changelog-remote.js';
import { runJourneys } from './commands/journeys-command.js';
import { refiningRecord, selectingRecord } from './commands/suite-record.js';
import { runJourneyArtifactCommand } from './commands/journey-artifact-command.js';
import { formatPush, push, pushTicker } from './commands/push.js';
import { serve } from './commands/serve.js';
import { renderComment } from './commands/comment.js';
import { doctor, machineProbes } from './commands/doctor.js';
import { mainlinesOf, publishedLine } from './commands/share.js';
import { shareOutput, writeSuitePart } from './commands/suite-part.js';
import { runCarry } from './commands/carry.js';
import { runCollect, runCollectMerge } from './commands/collect-command.js';
import { runSuiteShare } from './commands/suite-share.js';
import type { Configless } from './commands/configless.js';
import { exitForDiagnosis, formatDiagnosis } from './commands/doctor-report.js';
import { VANTAGE_VARIABLE } from '@variance-authority/vantage';
import type { ChangelogSelection } from '@variance-authority/report';
import type { Parsed } from './parse.js';
import { rendererFor } from './renderer.js';
/**
 * What each command *does*, and the two things every one of them needs.
 *
 * Split from `bin.ts` when that file crossed the size gate, and the seam is the
 * one its own doc comment already named: the table of commands and flags is a
 * statement about the product, read by whoever is deciding what the tool offers;
 * this is the wiring, read by whoever is changing what it then does. They change
 * for different reasons, and the only thing crossing between them is `Parsed` —
 * which is exactly the point of parsing into a value first.
 */
export async function dispatch(
  parsed: Exclude<Parsed, { command: 'help' } | { command: 'version' } | Configless>,
  streams: { out(text: string): void; err(text: string): void; detach?(argv: readonly string[], log: string): number | undefined },
): Promise<ExitCode> {
  if (parsed.command === 'journeys' && parsed.operation !== undefined)
    return runJourneyArtifactCommand(parsed, streams);
  if (parsed.command === 'carry') return runCarry(parsed, streams, mainlinesOf);
  // The parts say how they were collected; a merge reads no project.
  if (parsed.command === 'collect' && parsed.operation === 'merge') return runCollectMerge(parsed, streams);
  // A suite's record alone: the root config declares the suite and its share,
  // and no project config is read.
  if (parsed.command === 'share' && parsed.suite !== undefined) return runSuiteShare({ ...parsed, suite: parsed.suite }, streams);
  if (parsed.command === 'journeys' && parsed.suite !== undefined) return runJourneys(parsed, streams);

  const config = await loadConfig(parsed.config);
  switch (parsed.command) {
    case 'collect':
      return runCollect(parsed, config, streams);

    case 'run': {
      const effective: Config =
        parsed.profile === undefined ? config : { ...config, profile: parsed.profile };
      const plan = await planFor(effective);

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

      const identity = identityOf(
        {
          ...(parsed.run !== undefined ? { run: parsed.run } : {}),
          ...(parsed.commit !== undefined ? { commit: parsed.commit } : {}),
        },
        process.env,
      );

      try {
        const report = await run({
          config: effective,
          ...(parsed.subjects !== undefined ? { subjects: parsed.subjects } : {}),
          ...(parsed.shard !== undefined ? { shard: parsed.shard } : {}),
          ...(await costsToPlace(effective, parsed.shard !== undefined)),
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
            scanRelations: async (dirs) =>
              relationsFor(process.cwd(), dirs, effective.source?.taints, effective.before),
            readJourney: async (diff, relations) => {
              const { file, unmeasured } = await selectingRecord(process.cwd(), parsed.suite);
              return journeyAgainst(process.cwd(), diff, relations, file, process.cwd(), unmeasured);
            },
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

        // Last, and for the same reason: the cache this run may have added to
        // is regenerable, so nothing it does here can reach a verdict. It runs
        // on every run rather than on a command of its own — an operator who
        // knew to prune was never the one whose disk filled up — and on every
        // run rather than on the durable ones, because a machine that has moved
        // to a tribunal is the machine whose leftover cache nothing else will
        // ever come back for.
        const renders = renderCacheLine(await sweepRenders(effective)) + (await pruneWhenDueLines(effective));

        streams.out(
          `${formatReport({ report, format: 'text' })}\n\nreport: ${said(effective.report)}\n${shared}${renders}`,
        );
        return sideJob(exitFor(report), parsed.exitZeroOnChanges, streams);
      } finally {
        await collector.close();
      }
    }

    case 'report': {
      const report = await reportsFor(parsed.reports, config, parsed.embedImages);
      streams.out(
        formatReport({
          report,
          format: parsed.format,
          ...(parsed.subject !== undefined ? { subject: parsed.subject } : {}),
        }),
      );
      // The artifact decides the code, exactly as it decided the text. A `report`
      // that exited 0 while describing a change would make the two halves of this
      // tool disagree about the same file.
      return sideJob(exitFor(report), parsed.exitZeroOnChanges, streams);
    }

    case 'ask': {
      // The watcher address defaults to the variable the suite was started with,
      // so a shell that has one exported asks a live question with no flag — and
      // one that has not is told, by the question itself, what is missing.
      const at = parsed.at ?? process.env[VANTAGE_VARIABLE];
      const reports = parsed.reports.map((path) => resolve(path));
      streams.out(
        await ask({
          ...parsed,
          ...(at === undefined ? {} : { at }),
          report: config.report,
          read: () => reportsFor(reports, config), costs: () => costsSubject(config, reports),
          decisions: (input) => decisionsSubject(config, input),
        }),
      );
      // A reading is not a verdict. `report` and `adjudicate` are where a run is
      // gated, and an agent working through a dozen questions must not be handed
      // a dozen failures for having read a run that has something in it.
      return EXIT_CLEAN;
    }

    case 'adjudicate': {
      // Both halves before either is used, so a broken declaration is reported
      // as a broken declaration rather than as a run with nothing in it.
      const claims = await readClaims(parsed.claims);
      const report = await reportsFor(parsed.reports, config);
      const result = adjudicateReport({ report, claims });

      streams.out(formatAdjudication(result));
      return sideJob(exitForAdjudication(result), parsed.exitZeroOnChanges, streams);
    }

    case 'accept': {
      const report = await reportToPromoteFrom(config.report);
      const acceptHistory = await historyFor(config);
      const result = await accept({
        report,
        reportDir: dirname(config.report),
        store: await storeFor(config),
        subjects: parsed.subjects,
        all: parsed.all,
        shapes: parsed.shapes,
        read: readCandidate,
        // The acceptance is recorded where the observations went, under the same
        // project, or nowhere at all. Passed together so a store with no project
        // is unrepresentable rather than a silent scope nobody chose.
        ...(acceptHistory !== undefined
          ? { history: acceptHistory, project: config.history?.project ?? config.project }
          : {}),
        now: () => new Date().toISOString(),
      });

      streams.out(`${formatAcceptance(result)}\n`);

      // After the acceptance is printed, so the operator reads what was promoted
      // before they read what was written about it — and so a message that could
      // not be written does not look like an accept that did not happen.
      if (parsed.messageFile !== undefined) {
        streams.out(
          `${await writeAcceptMessage({
            report,
            result,
            selection: selectionOf(parsed),
            path: parsed.messageFile,
            message: parsed.message ?? 'chore(variance): regenerate baselines',
            at: new Date().toISOString(),
            project: config.project,
          })}\n`,
        );
      }

      return result.refused.length > 0 ? EXIT_OPERATOR : EXIT_CLEAN;
    }

    case 'changelog': {
      const view = {
        ...(parsed.component !== undefined ? { component: parsed.component } : {}),
        ...(parsed.subject !== undefined ? { subject: parsed.subject } : {}),
      };
      const store = changelogStoreFor(config);
      if ('deployment' in store) {
        const read = await readRemoteChangelog({
          config,
          deployment: store.deployment,
          ...view,
          ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
          ...(parsed.since !== undefined ? { since: parsed.since } : {}),
        });
        streams.out(
          `${formatRemoteChangelog(read, store.deployment, {
            ...view,
            ...(parsed.since !== undefined ? { since: parsed.since } : {}),
          })}\n`,
        );
        return EXIT_CLEAN;
      }

      const result = await changelog({
        root: store.root,
        ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
        ...(parsed.since !== undefined ? { since: parsed.since } : {}),
      });

      streams.out(`${formatChangelog(result, view)}\n`);

      // Reading a record is never a verdict about the project. This exits 0 even
      // when it found nothing, because "no baseline was explained" is an answer
      // and not a failure — the failures already threw.
      return EXIT_CLEAN;
    }

    case 'journeys':
      return runJourneys(parsed, streams, config.report);

    case 'push': {
      if (config.review === undefined) {
        throw new OperatorError(
          'no `review` in the config, so there is no review surface to push to. It takes an ' +
            '`endpoint` and the deployment\'s **ingest** token — never the review one, which ' +
            'promotes baselines.',
        );
      }

      // The same resolution `run` uses, and deliberately the same one: a build
      // pushed under an id the history record never heard of is a build nobody
      // can join to anything. `--branch` is separate because no CI system agrees
      // on where it lives, and a wrong guess would attribute a decision to the
      // wrong branch.
      const identity = identityOf(
        {
          ...(parsed.run !== undefined ? { run: parsed.run } : {}),
          ...(parsed.commit !== undefined ? { commit: parsed.commit } : {}),
        },
        process.env,
      );

      if (identity === undefined) {
        throw new OperatorError(
          'this build has no id and no commit. Pass `--run <id> --commit <sha>`, or run this ' +
            'where GITHUB_RUN_ID, CI_PIPELINE_ID or BITBUCKET_BUILD_NUMBER is set with its ' +
            'commit. Neither is invented: a build filed under an id nobody chose cannot be ' +
            'found again, and one with no commit cannot be joined to what shipped.',
        );
      }

      // Progress on stderr, and cleared before anything is written to stdout.
      // Reading and encoding a suite's images is where a push spends its time,
      // and a command that prints nothing for a minute is one an operator kills.
      const ticker = pushTicker(streams.err, process.stderr.isTTY === true);
      let pushed;
      try {
        pushed = await push({
          report: await reportsFor(parsed.reports, config),
          reportDir: dirname(config.report),
          review: config.review,
          build: identity.run,
          commit: identity.commit,
          ...(parsed.branch !== undefined ? { branch: parsed.branch } : {}),
          ...(config.share !== undefined ? { share: config.share } : {}),
          onProgress: ticker.on,
        });
      } finally {
        ticker.done();
      }

      streams.out(`${formatPush(pushed)}\n`);

      // `0` for "the service has it", not for "the run was clean". The verdict
      // belongs to the run that wrote the report, and this command reading it a
      // second time could only disagree with it.
      return EXIT_CLEAN;
    }

    case 'serve':
      await serve(config, parsed.justAnswer === true ? { justAnswer: true } : {});
      // The server owns the process from here; stdio is the protocol. Returning
      // would close it, so this resolves only when the stream does.
      await new Promise<void>(() => undefined);
      return EXIT_CLEAN;

    case 'doctor': {
      const diagnosis = await doctor(config, machineProbes(config));
      streams.out(`${formatDiagnosis(diagnosis)}\n`);
      return exitForDiagnosis(diagnosis);
    }

    case 'share': {
      streams.out(`${(await shareOutput(config, parsed)).join('\n')}\n`);
      return EXIT_CLEAN;
    }

    case 'comment': {
      const report = await reportsFor(parsed.reports, config);
      const body = renderComment({
        report,
        ...(parsed.runUrl !== undefined ? { runUrl: parsed.runUrl } : {}),
        ...(parsed.toAccept !== undefined ? { toAccept: parsed.toAccept } : {}),
        ...(parsed.imageRoot !== undefined ? { imageRoot: parsed.imageRoot } : {}),
      });

      // An empty file, never a missing one. The poster has to tell "nothing
      // needs review" from "the render never ran", and only the first of those
      // may clear a previous docket.
      //
      // Terminated, both ways. On a terminal the prompt would otherwise return
      // on the last line of the comment; in a file it is the line every tool
      // that reads text files expects, and an empty body stays empty because
      // the newline is only added to one that has content.
      const text = body === '' ? body : `${body}\n`;
      if (parsed.bodyFile !== undefined) await writeFile(parsed.bodyFile, text, 'utf8');
      else streams.out(text);

      // `0` for "this rendered", not for "the run was clean". The verdict is
      // `run`'s and the workflow already has it; a second opinion here could
      // only disagree with it.
      return EXIT_CLEAN;
    }
  }
}

/**
 * How the operator chose what to accept, which is how much review it had.
 *
 * Recorded rather than inferred later, because `--all` and a named subject are
 * not the same claim and a record that flattened them would let a regeneration
 * read, a month on, exactly like a review.
 */
function selectionOf(parsed: Extract<Parsed, { command: 'accept' }>): ChangelogSelection {
  if (parsed.all) return 'all';
  if (parsed.shapes.length > 0) return 'shape';
  return 'named';
}

/**
 * `--exit-zero-on-changes`: a check that reports without gating the merge.
 *
 * The alternative an operator reaches for is `|| true`, and it is worse than it
 * looks: it swallows exit 2 along with exit 1, so a job whose browser never
 * launched — which observed nothing and therefore found nothing — becomes a
 * green tick. That is the precise collapse ADR-0017 exists to prevent, arrived
 * at by a shell operator rather than by this code, which does not make it less
 * of a green check over an unwatched surface.
 *
 * So the suppression is narrow: exit 1 becomes exit 0, exit 2 stays exit 2, and
 * the line to stderr is not optional. A run whose code was suppressed silently
 * is indistinguishable in a log from a run that found nothing, and the whole
 * value of a non-blocking check is that somebody still reads it.
 */
function sideJob(
  code: ExitCode,
  suppress: boolean,
  streams: { err(text: string): void },
): ExitCode {
  if (!suppress || code !== EXIT_REVIEW) return code;
  streams.err('changes need review; --exit-zero-on-changes exits 0, not 1.\n');
  return EXIT_CLEAN;
}
