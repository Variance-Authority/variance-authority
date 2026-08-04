#!/usr/bin/env node
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { ProfileId } from '@variance-authority/core';
import { noPositionals, readFlags } from './args.js';
import { messageOf } from './config-values.js';
import { EXIT_CLEAN, EXIT_OPERATOR, OperatorError, type ExitCode } from './exit.js';
import { dispatch } from './dispatch.js';
import type { ReportFormat } from './commands/report.js';

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
 *
 * The hyphen-level work — reading `--flag=value`, honouring `--`, refusing a
 * repeated flag — is in `args.ts`, which is told what is accepted and decides
 * nothing about it. The table below is the part that is a statement about the
 * product: which commands exist, which flags each one takes, and what a reader
 * who gets it wrong is shown. Those two change for different reasons and are
 * read by different people, which is the whole of why they are apart.
 */

export type Parsed =
  | {
      readonly command: 'run';
      readonly config: string;
      readonly profile?: ProfileId;
      readonly subjects?: string;
      readonly intent?: string;
      readonly exitZeroOnChanges: boolean;
    }
  | {
      readonly command: 'report';
      readonly config: string;
      readonly format: ReportFormat;
      readonly subject?: string;
      readonly exitZeroOnChanges: boolean;
      /** Reports to read instead of the configured one. More than one is merged. */
      readonly reports: readonly string[];
    }
  | { readonly command: 'accept'; readonly config: string; readonly subjects: readonly string[]; readonly all: boolean }
  | { readonly command: 'serve'; readonly config: string }
  | { readonly command: 'doctor'; readonly config: string }
  | {
      readonly command: 'comment';
      readonly config: string;
      readonly bodyFile?: string;
      readonly runUrl?: string;
      readonly marker: boolean;
      /** Reports to read instead of the configured one. More than one is merged. */
      readonly reports: readonly string[];
    }
  | { readonly command: 'help' };

const COMMANDS = ['run', 'report', 'accept', 'serve', 'doctor', 'comment'] as const;

const DEFAULT_CONFIG = 'variance.config.json';

/** Flags every command takes, listed once so the refusals stay accurate. */
const GLOBAL = ['--config'] as const;

const PER_COMMAND: Record<(typeof COMMANDS)[number], readonly string[]> = {
  run: ['--profile', '--subjects', '--intent', '--exit-zero-on-changes'],
  report: ['--format', '--subject', '--exit-zero-on-changes'],
  accept: ['--all'],
  serve: [],
  doctor: [],
  comment: ['--body-file', '--run-url', '--marker'],
};

export const USAGE = [
  'variance run     [--config <path>] [--profile jsdom|chromium] [--subjects <glob>] [--intent <text>] [--exit-zero-on-changes]',
  'variance report  [--config <path>] [--format text|json|html] [--subject <id>] [--exit-zero-on-changes] [<report>...]',
  'variance accept  [--config <path>] <subject>... | --all',
  'variance serve   [--config <path>]              # MCP over stdio',
  'variance doctor  [--config <path>]',
  'variance comment [--config <path>] [--body-file <path>] [--run-url <url>] [<report>...] | --marker',
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

  const flags = readFlags(argv.slice(1), first, [...GLOBAL, ...(PER_COMMAND[first] ?? [])], USAGE);
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
        exitZeroOnChanges: flags.present.has('--exit-zero-on-changes'),
      };
    }

    case 'report': {
      const format = flags.values.get('--format') ?? 'text';
      if (format !== 'text' && format !== 'json' && format !== 'html') {
        throw new OperatorError(`--format must be text, json or html, not \`${format}\``);
      }
      const subject = flags.values.get('--subject');

      return {
        command: 'report',
        config,
        format,
        ...(subject !== undefined ? { subject } : {}),
        exitZeroOnChanges: flags.present.has('--exit-zero-on-changes'),
        // Named paths, not the configured one. A shard writes where its job told
        // it to, so `report` has to be able to read reports the config has never
        // heard of — and once it names them, adding the configured report to the
        // pile would merge in a file the operator did not ask for (ADR-0020).
        reports: flags.positionals.map((path) => resolve(path)),
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
      const bodyFile = flags.values.get('--body-file');
      const runUrl = flags.values.get('--run-url');
      const marker = flags.present.has('--marker');

      if (marker && (bodyFile !== undefined || runUrl !== undefined || flags.positionals.length > 0)) {
        // Two different questions, and answering both at once would mean
        // deciding which one the exit code is about. `--marker` is a constant
        // this build carries; the body is a reading of a report that may not
        // exist yet.
        throw new OperatorError(
          '`--marker` prints the marker and nothing else; it does not take --body-file, ' +
            '--run-url or a report',
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
        reports: flags.positionals.map((path) => resolve(path)),
      };
    }
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
