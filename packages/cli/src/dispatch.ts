import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { loadConfig, loadRenderless } from './config-load.js';
import { EXIT_CLEAN, EXIT_OPERATOR, OperatorError, exitFor, sideJob, type ExitCode } from './exit.js';
import type { Configless } from './commands/configless.js';
import type { ChangelogSelection } from '@variance-authority/report';
import type { Parsed } from './parse.js';
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
  parsed: Exclude<Parsed, { command: 'help' } | { command: 'version' } | { command: 'job' } | Configless>,
  streams: { out(text: string): void; err(text: string): void; detach?(argv: readonly string[], log: string): number | undefined },
): Promise<ExitCode> {
  if (parsed.command === 'journeys' && parsed.operation !== undefined)
    return (await import('./commands/journey-artifact-command.js')).runJourneyArtifactCommand(parsed, streams);
  if (parsed.command === 'carry') {
    const [{ runCarry }, { mainlinesOf }] = await Promise.all([import('./commands/carry.js'), import('./commands/share.js')]);
    return runCarry(parsed, streams, mainlinesOf);
  }
  // The parts say how they were collected; a merge reads no project.
  if (parsed.command === 'collect' && parsed.operation === 'merge') return (await import('./commands/collect-command.js')).runCollectMerge(parsed, streams);
  if (parsed.command === 'share' && parsed.suite === undefined && parsed.purgeOlderThan !== undefined)
    return (await import('./commands/share-purge.js')).runSharePurge({ ...parsed, purgeOlderThan: parsed.purgeOlderThan }, streams);
  if (parsed.command === 'share') {
    const rooted = await (await import('./commands/share-suites.js')).runRootShare(parsed, streams);
    if (rooted !== undefined) return rooted;
  }
  if (parsed.command === 'journeys') {
    const suite = parsed.suite ?? (await (await import('./commands/suite-record.js')).onlySuiteOf(parsed.config));
    if (suite !== undefined) return (await import('./commands/journeys-command.js')).runJourneys({ ...parsed, suite }, streams);
  }

  const renderless = parsed.command === 'doctor' && parsed.baselines !== true ? await loadRenderless(parsed.config) : undefined;
  if (renderless !== undefined) {
    const [{ formatRenderless }, { renderlessDoctor }] = await Promise.all([import('./commands/doctor-report.js'), import('./commands/doctor.js')]);
    streams.out(`${formatRenderless(await renderlessDoctor(renderless))}\n`);
    return EXIT_CLEAN;
  }

  const config = await loadConfig(parsed.config);
  switch (parsed.command) {
    case 'collect':
      return (await import('./commands/collect-command.js')).runCollect(parsed, config, streams);

    case 'run':
      return (await import('./commands/run-command.js')).runCommand(parsed, config, streams);

    case 'report': {
      const [{ formatReport }, { reportsFor }] = await Promise.all([import('./commands/report.js'), import('./commands/report-read.js')]);
      if (parsed.format === 'html') {
        const report = await (await import('./commands/report-page.js')).writeReportPage(
          { paths: parsed.reports, config, embedImages: parsed.embedImages, ...(parsed.subject !== undefined ? { subject: parsed.subject } : {}) },
          streams,
        );
        return sideJob(exitFor(report), parsed.exitZeroOnChanges, streams);
      }
      const report = await reportsFor(parsed.reports, config);
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
      const [{ VANTAGE_VARIABLE }, { ask, costsSubject }, { reviewSubject }, { reportsFor }] = await Promise.all([
        import('@variance-authority/vantage'),
        import('./commands/ask.js'),
        import('./commands/ask-review.js'),
        import('./commands/report-read.js'),
      ]);
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
          review: (tool, input) => reviewSubject(config, tool, input),
        }),
      );
      // A reading is not a verdict. `report` and `adjudicate` are where a run is
      // gated, and an agent working through a dozen questions must not be handed
      // a dozen failures for having read a run that has something in it.
      return EXIT_CLEAN;
    }

    case 'adjudicate': {
      const [{ adjudicateReport, exitForAdjudication, formatAdjudication, readClaims }, { reportsFor }] = await Promise.all([
        import('./commands/adjudicate.js'),
        import('./commands/report-read.js'),
      ]);
      // Both halves before either is used, so a broken declaration is reported
      // as a broken declaration rather than as a run with nothing in it.
      const claims = await readClaims(parsed.claims);
      const report = await reportsFor(parsed.reports, config);
      const result = adjudicateReport({ report, claims });

      streams.out(formatAdjudication(result));
      return sideJob(exitForAdjudication(result), parsed.exitZeroOnChanges, streams);
    }

    case 'accept': {
      const [{ accept, formatAcceptance, readCandidate, reportToPromoteFrom }, { historyFor, storeFor }] = await Promise.all([
        import('./commands/accept.js'),
        import('./commands/run.js'),
      ]);
      const report = await reportToPromoteFrom(config.report);
      const acceptHistory = await historyFor(config);
      const result = await accept({
        report,
        reportDir: dirname(config.report),
        store: await storeFor(config),
        subjects: parsed.subjects,
        all: parsed.all,
        shapes: parsed.shapes,
        ...(parsed.by !== undefined ? { by: parsed.by } : {}),
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
          `${await (await import('./commands/accept-message.js')).writeAcceptMessage({
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
      const { changelog, changelogStoreFor, formatChangelog } = await import('./commands/changelog.js');
      const view = {
        ...(parsed.component !== undefined ? { component: parsed.component } : {}),
        ...(parsed.subject !== undefined ? { subject: parsed.subject } : {}),
      };
      const since = parsed.since !== undefined ? { since: parsed.since } : {};
      const bounds = { ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}), ...since };
      const store = changelogStoreFor(config);
      if ('deployment' in store) {
        const { formatRemoteChangelog, readRemoteChangelog } = await import('./commands/changelog-remote.js');
        const read = await readRemoteChangelog({
          config,
          deployment: store.deployment,
          ...view,
          ...bounds,
        });
        streams.out(`${formatRemoteChangelog(read, store.deployment, { ...view, ...since })}\n`);
        return EXIT_CLEAN;
      }

      const result = await changelog({ root: store.root, ...bounds });

      streams.out(`${formatChangelog(result, view)}\n`);

      // Reading a record is never a verdict about the project. This exits 0 even
      // when it found nothing, because "no baseline was explained" is an answer
      // and not a failure — the failures already threw.
      return EXIT_CLEAN;
    }

    case 'journeys':
      return (await import('./commands/journeys-command.js')).runJourneys(parsed, streams, config.report);

    case 'push': {
      if (config.review === undefined) {
        throw new OperatorError(
          'no `review` in the config, so there is no review surface to push to. It takes an ' +
            '`endpoint` and the deployment\'s **ingest** token — never the review one, which ' +
            'promotes baselines.',
        );
      }

      const [{ identityOf }, { formatPush, push, pushTicker }, { reportsFor }] = await Promise.all([
        import('./commands/run.js'),
        import('./commands/push.js'),
        import('./commands/report-read.js'),
      ]);

      // The same resolution `run` uses, and deliberately the same one: a build
      // pushed under an id the history record never heard of is a build nobody
      // can join to anything. `--branch` is separate because no CI system agrees
      // on where it lives, and a wrong guess would attribute a decision to the
      // wrong branch.
      const identity = identityOf(parsed, process.env);

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
          ...(config.baselines !== undefined ? { baselines: config.baselines } : {}),
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
      await (await import('./commands/serve.js')).serve(config, parsed.justAnswer === true ? { justAnswer: true } : {});
      // The server owns the process from here; stdio is the protocol. Returning
      // would close it, so this resolves only when the stream does.
      await new Promise<void>(() => undefined);
      return EXIT_CLEAN;

    case 'doctor': {
      const [{ baselineFinding, doctor, machineProbes }, { exitForBaselines, exitForDiagnosis, formatBaselines, formatDiagnosis }] = await Promise.all([
        import('./commands/doctor.js'),
        import('./commands/doctor-report.js'),
      ]);
      // The store alone: no browser launched, no font measured, so the action
      // can ask it before every run for the price of reading the store's heads.
      if (parsed.baselines === true) {
        const finding = await baselineFinding(config, machineProbes(config));
        streams.out(`${formatBaselines(finding)}\n`);
        return exitForBaselines(finding);
      }
      const diagnosis = await doctor(config, machineProbes(config));
      streams.out(`${formatDiagnosis(diagnosis)}\n`);
      return exitForDiagnosis(diagnosis);
    }

    case 'share': {
      streams.out(`${(await (await import('./commands/suite-part.js')).shareOutput(config, parsed)).join('\n')}\n`);
      return EXIT_CLEAN;
    }

    case 'comment': {
      // The poster's question, asked where no body may exist to find it in: a
      // clean run, whose previous docket has to be located and cleared.
      const { clearedComment, commentMarker } = await import('./commands/comment-marker.js');
      if (parsed.marker) {
        streams.out(`${commentMarker(config.project)}\n`);
        return EXIT_CLEAN;
      }
      if (parsed.cleared) {
        streams.out(`${clearedComment(config.project)}\n`);
        return EXIT_CLEAN;
      }
      const report = await (await import('./commands/report-read.js')).reportsFor(parsed.reports, config);
      const body = (await import('./commands/comment.js')).renderComment({
        project: config.project,
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
