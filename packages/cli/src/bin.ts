#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ProfileId } from '@variance-authority/core';
import type { Renderer } from '@variance-authority/raster';
import { loadConfig, type Config } from './config.js';
import { EXIT_CLEAN, EXIT_OPERATOR, OperatorError, exitFor, type ExitCode } from './exit.js';
import {
  loadCollector,
  planList,
  planStorybook,
  readCliRunReport,
  run,
  storeFor,
  writeArtifactToDisk,
  writeCliRunReport,
  type Plan,
} from './commands/run.js';
import { formatReport, type ReportFormat } from './commands/report.js';
import { accept, formatAcceptance, readCandidate } from './commands/accept.js';
import { serve } from './commands/serve.js';
import { COMMENT_MARKER, renderComment } from './commands/comment.js';
import { doctor, exitForDiagnosis, formatDiagnosis, machineProbes } from './commands/doctor.js';

/**
 * The command line, parsed by hand.
 *
 * No argument-parsing dependency, for the same reason nothing else here has one:
 * this package is the entry point of a tool whose entire claim is that its output
 * can be trusted, and a transitive dependency graph is a set of things that can
 * change what `--profile` means without anybody deciding to.
 *
 * Hand-written parsing costs about eighty lines and buys three properties that
 * the convenient libraries specifically do not have:
 *
 * **An unknown flag is an error.** Every popular parser either ignores unknown
 * flags or collects them into a bag. Both are the same failure: `--subject` where
 * `--subjects` was meant runs the whole suite and reports success, and the
 * operator reads their own shell history and sees the flag they intended. A
 * misspelled flag must stop the run, and it must name the flags that exist.
 *
 * **Flags are per-command.** `--format json` is meaningless on `run`, and
 * accepting it there teaches the operator a false model of the tool. Each
 * command's accepted set is written down, and the refusal prints it.
 *
 * **A flag that takes a value must get one.** `variance report --format` with
 * nothing after it is a mistake, not a request for the default; a parser that
 * silently falls back turns a typo into a different report.
 *
 * `--flag=value` and `--flag value` are both accepted because both are muscle
 * memory, and `--` ends flag parsing so a subject id may begin with a dash.
 */

export type Parsed =
  | { readonly command: 'run'; readonly config: string; readonly profile?: ProfileId; readonly subjects?: string; readonly intent?: string }
  | { readonly command: 'report'; readonly config: string; readonly format: ReportFormat; readonly subject?: string }
  | { readonly command: 'accept'; readonly config: string; readonly subjects: readonly string[]; readonly all: boolean }
  | { readonly command: 'serve'; readonly config: string }
  | { readonly command: 'doctor'; readonly config: string }
  | {
      readonly command: 'comment';
      readonly config: string;
      readonly bodyFile?: string;
      readonly runUrl?: string;
      readonly marker: boolean;
    }
  | { readonly command: 'help' };

const COMMANDS = ['run', 'report', 'accept', 'serve', 'doctor', 'comment'] as const;

const DEFAULT_CONFIG = 'variance.config.json';

/** Flags every command takes, listed once so the refusals stay accurate. */
const GLOBAL = ['--config'] as const;

const PER_COMMAND: Record<(typeof COMMANDS)[number], readonly string[]> = {
  run: ['--profile', '--subjects', '--intent'],
  report: ['--format', '--subject'],
  accept: ['--all'],
  serve: [],
  doctor: [],
  comment: ['--body-file', '--run-url', '--marker'],
};

export const USAGE = [
  'variance run     [--config <path>] [--profile jsdom|chromium] [--subjects <glob>] [--intent <text>]',
  'variance report  [--config <path>] [--format text|json] [--subject <id>]',
  'variance accept  [--config <path>] <subject>... | --all',
  'variance serve   [--config <path>]              # MCP over stdio',
  'variance doctor  [--config <path>]',
  'variance comment [--config <path>] [--body-file <path>] [--run-url <url>] | --marker',
  '',
  'exit codes: 0 nothing needs review, 1 changes need review, 2 operator error.',
  'A verdict and a crash never share a code.',
].join('\n');

export function parseArgs(argv: readonly string[]): Parsed {
  const first = argv[0];

  if (first === undefined || first === '--help' || first === '-h' || first === 'help') {
    return { command: 'help' };
  }

  if (!isCommand(first)) {
    throw new OperatorError(
      `unknown command \`${first}\`; this tool has ${COMMANDS.join(', ')}\n\n${USAGE}`,
    );
  }

  const flags = readFlags(argv.slice(1), first);
  const config = resolve(flags.values.get('--config') ?? DEFAULT_CONFIG);

  switch (first) {
    case 'run': {
      const profile = flags.values.get('--profile');
      if (profile !== undefined && profile !== 'jsdom' && profile !== 'chromium') {
        throw new OperatorError(
          `--profile must be jsdom or chromium, not \`${profile}\``,
        );
      }
      const subjects = flags.values.get('--subjects');
      const intent = flags.values.get('--intent');
      noPositionals(flags.positionals, 'run');

      return {
        command: 'run',
        config,
        ...(profile !== undefined ? { profile } : {}),
        ...(subjects !== undefined ? { subjects } : {}),
        ...(intent !== undefined ? { intent } : {}),
      };
    }

    case 'report': {
      const format = flags.values.get('--format') ?? 'text';
      if (format !== 'text' && format !== 'json') {
        throw new OperatorError(`--format must be text or json, not \`${format}\``);
      }
      const subject = flags.values.get('--subject');
      noPositionals(flags.positionals, 'report');

      return {
        command: 'report',
        config,
        format,
        ...(subject !== undefined ? { subject } : {}),
      };
    }

    case 'accept': {
      const all = flags.present.has('--all');
      if (!all && flags.positionals.length === 0) {
        throw new OperatorError(
          'accept needs a subject id, or --all. Accepting nothing and accepting everything ' +
            'are different requests and this will not guess which was meant.',
        );
      }
      if (all && flags.positionals.length > 0) {
        // Refused rather than resolved in either direction: honouring --all would
        // silently accept subjects the operator did not name, and honouring the
        // names would silently ignore a flag they typed.
        throw new OperatorError(
          `--all accepts every changed subject, but ${flags.positionals.join(', ')} ` +
            'was also named; pass one or the other',
        );
      }
      return { command: 'accept', config, subjects: flags.positionals, all };
    }

    case 'serve':
      noPositionals(flags.positionals, 'serve');
      return { command: 'serve', config };

    case 'doctor':
      noPositionals(flags.positionals, 'doctor');
      return { command: 'doctor', config };

    case 'comment': {
      noPositionals(flags.positionals, 'comment');
      const bodyFile = flags.values.get('--body-file');
      const runUrl = flags.values.get('--run-url');
      const marker = flags.present.has('--marker');

      if (marker && (bodyFile !== undefined || runUrl !== undefined)) {
        // Two different questions, and answering both at once would mean
        // deciding which one the exit code is about. `--marker` is a constant
        // this build carries; the body is a reading of a report that may not
        // exist yet.
        throw new OperatorError(
          '`--marker` prints the marker and nothing else; it does not take --body-file or --run-url',
        );
      }

      return {
        command: 'comment',
        config,
        marker,
        ...(bodyFile !== undefined ? { bodyFile } : {}),
        // An empty `--run-url` is the workflow's "the operator published
        // nothing", which must read as absent rather than as a link to ''.
        ...(runUrl !== undefined && runUrl !== '' ? { runUrl } : {}),
      };
    }
  }
}

interface Flags {
  readonly values: Map<string, string>;
  /** Flags that appeared, valued or not. Lets `--all` be a boolean without a value. */
  readonly present: Set<string>;
  readonly positionals: readonly string[];
}

const BOOLEAN = new Set(['--all', '--marker']);

function readFlags(argv: readonly string[], command: (typeof COMMANDS)[number]): Flags {
  const accepted = [...GLOBAL, ...(PER_COMMAND[command] ?? [])];
  const values = new Map<string, string>();
  const present = new Set<string>();
  const positionals: string[] = [];

  let index = 0;
  let flagsEnded = false;

  while (index < argv.length) {
    const argument = argv[index] as string;
    index += 1;

    if (flagsEnded || !argument.startsWith('-')) {
      positionals.push(argument);
      continue;
    }

    if (argument === '--') {
      flagsEnded = true;
      continue;
    }

    const equals = argument.indexOf('=');
    const name = equals === -1 ? argument : argument.slice(0, equals);

    if (!accepted.includes(name)) {
      throw new OperatorError(
        `\`${name}\` is not a flag \`variance ${command}\` accepts; it takes ` +
          `${accepted.join(', ')}\n\n${USAGE}`,
      );
    }
    if (present.has(name)) {
      // Repeated flags are refused rather than last-wins: two contradicting
      // `--subjects` on one line means the operator believes one of them is in
      // force, and picking either silently makes half of those beliefs wrong.
      throw new OperatorError(`\`${name}\` was given more than once`);
    }
    present.add(name);

    if (BOOLEAN.has(name)) {
      if (equals !== -1) throw new OperatorError(`\`${name}\` takes no value`);
      continue;
    }

    const inline = equals === -1 ? undefined : argument.slice(equals + 1);
    const value = inline ?? argv[index];

    if (value === undefined || (inline === undefined && value.startsWith('-'))) {
      throw new OperatorError(
        `\`${name}\` needs a value; nothing followed it. A missing value is a mistake, ` +
          'not a request for the default.',
      );
    }
    if (inline === undefined) index += 1;
    values.set(name, value);
  }

  return { values, present, positionals };
}

function noPositionals(positionals: readonly string[], command: string): void {
  if (positionals.length > 0) {
    throw new OperatorError(
      `\`variance ${command}\` takes no positional arguments, and got ${positionals.join(', ')}`,
    );
  }
}

function isCommand(value: string): value is (typeof COMMANDS)[number] {
  return (COMMANDS as readonly string[]).includes(value);
}

/**
 * Run one command and answer with an exit code.
 *
 * Every error that reaches here is either an {@link OperatorError} — a
 * distinguishable statement that the run could not happen as configured — or a
 * defect in this tool. The two print differently, because an operator reading
 * "cannot read the config file" should edit their config and an operator reading
 * a stack trace should file a bug, and a CLI that dresses the second up as the
 * first costs somebody an afternoon.
 */
export async function main(
  argv: readonly string[],
  streams: { out(text: string): void; err(text: string): void },
): Promise<ExitCode> {
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    streams.err(`${messageOf(error)}\n`);
    return EXIT_OPERATOR;
  }

  if (parsed.command === 'help') {
    streams.out(`${USAGE}\n`);
    return EXIT_CLEAN;
  }

  try {
    return await dispatch(parsed, streams);
  } catch (error) {
    if (error instanceof OperatorError) {
      streams.err(`${messageOf(error)}\n`);
      return EXIT_OPERATOR;
    }
    streams.err(
      `variance failed in a way it does not have a code for, which is a defect in the tool ` +
        `rather than a finding about your project:\n${stackOf(error)}\n`,
    );
    return EXIT_OPERATOR;
  }
}

async function dispatch(
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
      const collector = await loadCollector(effective.subjects.collector, {
        config: effective,
        ...(plan !== undefined ? { plan } : {}),
      });

      try {
        const report = await run({
          config: effective,
          ...(parsed.subjects !== undefined ? { subjects: parsed.subjects } : {}),
          ...(parsed.intent !== undefined ? { intent: parsed.intent } : {}),
          deps: {
            collector,
            store: await storeFor(effective),
            renderer: () => rendererFor(effective),
            now: () => new Date().toISOString(),
            writeArtifact: writeArtifactToDisk,
            writeReport: writeCliRunReport,
          },
        });

        streams.out(
          `${formatReport({ report, format: 'text' })}\n\nreport: ${effective.report}\n`,
        );
        return exitFor(report);
      } finally {
        await collector.close();
      }
    }

    case 'report': {
      const report = await readCliRunReport(config.report);
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
      return exitFor(report);
    }

    case 'accept': {
      const report = await readCliRunReport(config.report);
      const result = await accept({
        report,
        reportDir: dirname(config.report),
        store: await storeFor(config),
        subjects: parsed.subjects,
        all: parsed.all,
        read: readCandidate,
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
      const report = await readCliRunReport(config.report);
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

/** The generic half of planning, when the config named a source that has one. */
async function planFor(config: Config): Promise<Plan | undefined> {
  return config.subjects.kind === 'storybook'
    ? planStorybook(
        config.subjects.index,
        config.viewport,
        config.subjects.excludeTags,
      )
    : planList(config.subjects.ids);
}

/**
 * The renderer, imported lazily.
 *
 * `import()` rather than a top-level import so that `report`, `accept`, and
 * `serve` — none of which may render — do not load a browser driver in order to
 * read a file. The failure it produces when there is no browser is an operator
 * error with the underlying message intact, which is what makes `run --profile
 * chromium` on a machine without Chromium exit 2 rather than 1.
 */
async function rendererFor(config: Config): Promise<Renderer> {
  const { createPlaywrightRenderer } = await import('@variance-authority/playwright');
  try {
    return await createPlaywrightRenderer({ fonts: config.fonts });
  } catch (error) {
    throw new OperatorError(
      `no renderer could be opened on this machine: ${messageOf(error)}. ` +
        'Run `variance doctor` for what this machine can observe.',
      { cause: error },
    );
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function stackOf(error: unknown): string {
  return error instanceof Error ? (error.stack ?? error.message) : String(error);
}

/**
 * Only when this file *is* the program.
 *
 * The guard is what lets `parseArgs` and `main` be imported by a test without the
 * import itself parsing `process.argv` and exiting the test runner.
 */
const entry = process.argv[1];
if (entry !== undefined && import.meta.url === pathToFileURL(entry).href) {
  process.exitCode = await main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
