import { writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { Renderer } from '@variance-authority/raster';
import { messageOf } from './config-values.js';
import { loadConfig, type Config } from './config.js';
import {
  EXIT_CLEAN,
  EXIT_OPERATOR,
  EXIT_REVIEW,
  OperatorError,
  exitFor,
  type ExitCode,
} from './exit.js';
import {
  collectorPath,
  loadCollector,
  planList,
  planStorybook,
  changedSince,
  historyFor,
  identityOf,
  readCliRunReport,
  run,
  scanSourceDirs,
  storeFor,
  writeArtifactToDisk,
  writeCliRunReport,
  type CliRunReport,
  type Plan,
} from './commands/run.js';
import { formatReport } from './commands/report.js';
import { liveIgnores } from './commands/ignores.js';
import { mergeReports } from './commands/merge.js';
import { accept, formatAcceptance, readCandidate } from './commands/accept.js';
import { serve } from './commands/serve.js';
import { COMMENT_MARKER, renderComment } from './commands/comment.js';
import { doctor, machineProbes, rendererOptionsFor } from './commands/doctor.js';
import { exitForDiagnosis, formatDiagnosis } from './commands/doctor-report.js';
import type { Parsed } from './bin.js';

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
  parsed: Exclude<Parsed, { command: 'help' }>,
  streams: { out(text: string): void; err(text: string): void },
): Promise<ExitCode> {
  // Before the config, because the marker is a constant this build carries and
  // not a reading of anything. The poster needs it in exactly the case where
  // there is no body to find it in — a clean run, where the previous docket has
  // to be located and cleared.
  if (parsed.command === 'comment' && parsed.marker) {
    streams.out(`${COMMENT_MARKER}\n`);
    return EXIT_CLEAN;
  }

  const config = await loadConfig(parsed.config);

  switch (parsed.command) {
    case 'run': {
      const effective: Config =
        parsed.profile === undefined ? config : { ...config, profile: parsed.profile };
      const plan = await planFor(effective);

      // The collector is handed the rules that are still live. Expiry is a
      // run-level decision with a clock in it, and a collector — which runs in a
      // browser — is the wrong place to make one. An expired rule is simply never
      // sent, so what it used to absorb is reported again with no other machinery.
      const today = new Date().toISOString();
      const collector = await loadCollector(collectorPath(effective.subjects), {
        config: {
          ...effective,
          ...(effective.ignore !== undefined
            ? { ignore: liveIgnores(effective.ignore, today) }
            : {}),
        },
        ...(plan !== undefined ? { plan } : {}),
      });

      // Resolved here, from the flags and the process environment, so that `run`
      // itself stays free of both — it is handed an identity or it is not, and a
      // test can hand it one without setting environment variables that outlive
      // the test.
      const history = historyFor(effective);
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
          ...(parsed.intent !== undefined ? { intent: parsed.intent } : {}),
          ...(parsed.flakes ? { flakes: true } : {}),
          ...(identity !== undefined ? { identity } : {}),
          ...(parsed.since !== undefined
            ? { since: { ref: parsed.since, changed: await changedSince(parsed.since) } }
            : {}),
          deps: {
            collector,
            store: await storeFor(effective),
            renderer: () => rendererFor(effective),
            now: () => new Date().toISOString(),
            writeArtifact: writeArtifactToDisk,
            writeReport: writeCliRunReport,
            scanSource: async (dirs) => scanSourceDirs(process.cwd(), dirs),
            ...(history !== undefined ? { history } : {}),
          },
        });

        streams.out(
          `${formatReport({ report, format: 'text' })}\n\nreport: ${effective.report}\n`,
        );
        return sideJob(exitFor(report), parsed.exitZeroOnChanges, streams);
      } finally {
        await collector.close();
      }
    }

    case 'report': {
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

    case 'accept': {
      const report = await readCliRunReport(config.report);
      const acceptHistory = historyFor(config);
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
      return result.refused.length > 0 ? EXIT_OPERATOR : EXIT_CLEAN;
    }

    case 'serve':
      await serve(config);
      // The server owns the process from here; stdio is the protocol. Returning
      // would close it, so this resolves only when the stream does.
      await new Promise<void>(() => undefined);
      return EXIT_CLEAN;

    case 'doctor': {
      const diagnosis = await doctor(config, machineProbes(config));
      streams.out(`${formatDiagnosis(diagnosis)}\n`);
      return exitForDiagnosis(diagnosis);
    }

    case 'comment': {
      const report = await reportsFor(parsed.reports, config);
      const body = renderComment({
        report,
        ...(parsed.runUrl !== undefined ? { runUrl: parsed.runUrl } : {}),
      });

      // An empty file, never a missing one. The poster has to tell "nothing
      // needs review" from "the render never ran", and only the first of those
      // may clear a previous docket.
      if (parsed.bodyFile !== undefined) await writeFile(parsed.bodyFile, body, 'utf8');
      else streams.out(body);

      // `0` for "this rendered", not for "the run was clean". The verdict is
      // `run`'s and the workflow already has it; a second opinion here could
      // only disagree with it.
      return EXIT_CLEAN;
    }
  }
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
  streams.err(
    'changes need review, and --exit-zero-on-changes suppressed the exit code. ' +
      'This job is reporting, not gating. Operator errors are still exit 2.\n',
  );
  return EXIT_CLEAN;
}

/**
 * The report the operator meant: the configured one, or the shards they named.
 *
 * Shared by `report` and `comment` so a sharded suite gets *one* of each. Having
 * only the first take shard paths would leave the pull-request body reading a
 * single slice while the text output described the suite — two answers about one
 * run, from one binary, differing by which subcommand asked.
 */
async function reportsFor(paths: readonly string[], config: Config): Promise<CliRunReport> {
  const named = paths.length === 0 ? [config.report] : paths;
  return mergeReports(
    await Promise.all(named.map(async (path) => ({ path, report: await readCliRunReport(path) }))),
  );
}

/** The generic half of planning, when the config named a source that has one. */
async function planFor(config: Config): Promise<Plan | undefined> {
  if (config.subjects.kind === 'storybook') {
    return planStorybook(config.subjects.index, config.viewport, config.subjects.excludeTags);
  }

  // `collector` returns nothing on purpose: the collector's own `plan()` is the
  // answer, and handing it an empty one to return would make an *absent* plan
  // and a *discovered empty* plan indistinguishable — the second is a suite that
  // watches nothing and has to be able to say so.
  if (config.subjects.kind === 'collector') return undefined;

  // `images` never reaches here: `collectorPath` refuses it first, above, where
  // the refusal can name the command that does apply.
  if (config.subjects.kind === 'images') return undefined;

  return planList(config.subjects.ids);
}

/**
 * The renderer the config asks for, imported lazily.
 *
 * `import()` rather than a top-level import so that `report`, `accept`, and
 * `serve` — none of which may render — do not load a browser driver in order to
 * read a file. The failure it produces when there is no browser is an operator
 * error with the underlying message intact, which is what makes `run --profile
 * chromium` on a machine without Chromium exit 2 rather than 1.
 *
 * **Exported because the library half needs it (ADR-0024).** `deps.renderer` has
 * to be filled in by whoever composes a run, and this package's own README filled
 * it in with `createPlaywrightRenderer` from `@variance-authority/playwright` —
 * so the documented way to use the CLI as a library required knowing about the
 * browser package, which is the reach-through that ADR forbids. That example was
 * also wrong by then: it ignored `browser` and `renderer`, handing back a local
 * Chromium whatever the config said. One function answers both.
 */
export async function rendererFor(config: Config): Promise<Renderer> {
  // Somewhere else, if the config says so. Nothing downstream can tell: a remote
  // renderer satisfies the same contract, answers `identityFor` by the same
  // derivation, and is guarded by the same comparability check — which is what
  // makes the offload a wiring decision rather than a second pipeline.
  if (config.renderer !== undefined) {
    const { connectRenderer } = await import('@variance-authority/remote');
    const remote = config.renderer;
    return openRenderer(() =>
      connectRenderer({
        endpoint: remote.endpoint,
        ...(remote.timeoutMs === undefined ? {} : { timeoutMs: remote.timeoutMs }),
      }),
    );
  }

  const { createPlaywrightRenderer } = await import('@variance-authority/playwright');
  // The same expression `doctor` probes with. Two spellings of "what the config
  // says about the renderer" is how a green doctor and a failing run stop being
  // about the same machine.
  return openRenderer(() => createPlaywrightRenderer(rendererOptionsFor(config)));
}

/**
 * Any failure to open a renderer is an operator error, never a verdict.
 *
 * Exported, and taking the opener as an argument, for one reason: ADR-0017
 * requires `run --profile chromium` on a machine without Chromium to
 * exit 2 rather than 1, and until 2026-08-03 that was argued in a comment and
 * asserted by nothing — the only criterion in the spec still carried by prose.
 * It cannot be tested through `main` on a machine that *has* a browser, and
 * uninstalling one to check is not a test.
 *
 * The distinction is the whole of why exit 2 exists. Exit 1 means a component
 * changed and somebody should look; exit 2 means the run never happened. A
 * missing browser reported as 1 sends a reviewer to find a change nobody made,
 * and — worse — a CI step that treats 1 as "accept and move on" would record
 * baselines from a run that observed nothing.
 */
export async function openRenderer(open: () => Promise<Renderer>): Promise<Renderer> {
  try {
    return await open();
  } catch (error) {
    throw new OperatorError(
      `no renderer could be opened on this machine: ${messageOf(error)}. ` +
        'Run `variance doctor` for what this machine can observe.',
      { cause: error },
    );
  }
}
