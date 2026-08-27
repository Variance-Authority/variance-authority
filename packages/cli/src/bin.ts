#!/usr/bin/env node
import { resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
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
      /**
       * `--run` and `--commit`: which run this is, for a history record.
       *
       * Both or neither is not enforced here — `identityOf` requires the pair,
       * and a half-given pair falls back to the CI environment rather than being
       * completed from two sources, which would describe a run that never existed.
       */
      readonly run?: string;
      readonly commit?: string;
      /**
       * `--since <ref>`: observe only what the diff against this ref could have
       * changed. The ref is a git revision — a branch, a tag, a SHA.
       */
      readonly since?: string;
      /** `--flakes`: read every subject twice, not only the ones that changed. */
      readonly flakes: boolean;
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
  | {
      readonly command: 'accept';
      readonly config: string;
      readonly subjects: readonly string[];
      readonly all: boolean;
      /** Difference shapes to accept wherever they are the whole change. */
      readonly shapes: readonly string[];
      /**
       * `--message-file <path>`: write the commit message explaining this update.
       *
       * A file rather than a commit, because whether these baselines are
       * committed — and to which branch, as whom — belongs to the workflow that
       * already decides it, not to the command that promotes images.
       */
      readonly messageFile?: string;
      /** `--message <text>`: the subject line of that message. */
      readonly message?: string;
    }
  | {
      readonly command: 'changelog';
      readonly config: string;
      /** `--component <text>`: substring, case-insensitive. */
      readonly component?: string;
      /** `--subject <id>`: exact, because a subject id is exact. */
      readonly subject?: string;
      readonly limit?: number;
      /** `--since <rev>`: read forward from this revision, exclusive. */
      readonly since?: string;
    }
  | {
      readonly command: 'adjudicate';
      readonly config: string;
      /** `--claims <path>`: the declaration. Required; there is no default intent. */
      readonly claims: string;
      /** Reports to read instead of the configured one. More than one is merged. */
      readonly reports: readonly string[];
      readonly exitZeroOnChanges: boolean;
    }
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

const COMMANDS = [
  'run',
  'report',
  'adjudicate',
  'accept',
  'changelog',
  'serve',
  'doctor',
  'comment',
] as const;

const DEFAULT_CONFIG = 'variance.config.json';

/** Flags every command takes, listed once so the refusals stay accurate. */
const GLOBAL = ['--config'] as const;

const PER_COMMAND: Record<(typeof COMMANDS)[number], readonly string[]> = {
  run: [
    '--profile',
    '--subjects',
    '--intent',
    '--run',
    '--commit',
    '--since',
    '--flakes',
    '--exit-zero-on-changes',
  ],
  report: ['--format', '--subject', '--exit-zero-on-changes'],
  adjudicate: ['--claims', '--exit-zero-on-changes'],
  accept: ['--all', '--shape', '--message-file', '--message'],
  changelog: ['--component', '--subject', '--limit', '--since'],
  serve: [],
  doctor: [],
  comment: ['--body-file', '--run-url', '--marker'],
};

export const USAGE = [
  'variance run     [--config <path>] [--profile jsdom|chromium] [--subjects <glob>] [--intent <text>] [--run <id> --commit <sha>] [--since <ref>] [--flakes] [--exit-zero-on-changes]',
  'variance report  [--config <path>] [--format text|json|html] [--subject <id>] [--exit-zero-on-changes] [<report>...]',
  'variance adjudicate [--config <path>] --claims <path> [--exit-zero-on-changes] [<report>...]',
  'variance accept  [--config <path>] <subject>... | --all | --shape <fingerprint>[,...] [--message-file <path> [--message <text>]]',
  'variance changelog [--config <path>] [--component <text>] [--subject <id>] [--limit <n>] [--since <rev>]',
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
      const runId = flags.values.get('--run');
      const commit = flags.values.get('--commit');
      const since = flags.values.get('--since');
      noPositionals(flags.positionals, 'run');

      return {
        command: 'run',
        config,
        ...(profile !== undefined ? { profile } : {}),
        ...(subjects !== undefined ? { subjects } : {}),
        ...(intent !== undefined ? { intent } : {}),
        ...(runId !== undefined ? { run: runId } : {}),
        ...(commit !== undefined ? { commit } : {}),
        ...(since !== undefined ? { since } : {}),
        flakes: flags.present.has('--flakes'),
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

    case 'adjudicate': {
      const claims = flags.values.get('--claims');
      if (claims === undefined) {
        // No default, and no inference from the report. A declaration this
        // command invented would be one the author never made, and every arm of
        // the answer is about the distance between the two.
        throw new OperatorError(
          'adjudicate needs `--claims <path>`: what you meant to change, declared before the ' +
            'diff was read. Without it there is nothing to hold the run against and this would ' +
            'only repeat `variance report`.',
        );
      }

      return {
        command: 'adjudicate',
        config,
        claims: resolve(claims),
        reports: flags.positionals.map((path) => resolve(path)),
        exitZeroOnChanges: flags.present.has('--exit-zero-on-changes'),
      };
    }

    case 'accept': {
      const all = flags.present.has('--all');
      const shapes = (flags.values.get('--shape') ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter((value) => value !== '');

      if (!all && shapes.length === 0 && flags.positionals.length === 0) {
        throw new OperatorError(
          'accept needs a subject id, --shape, or --all. Accepting nothing and accepting ' +
            'everything are different requests and this will not guess which was meant.',
        );
      }
      if (all && (flags.positionals.length > 0 || shapes.length > 0)) {
        // Refused rather than resolved in either direction: honouring --all would
        // silently accept subjects the operator did not name, and honouring the
        // names would silently ignore a flag they typed.
        throw new OperatorError(
          `--all accepts every changed subject, but ${[...flags.positionals, ...shapes].join(', ')} ` +
            'was also named; pass one or the other',
        );
      }
      if (shapes.length > 0 && flags.positionals.length > 0) {
        // A shape selects subjects. Naming subjects as well asks two different
        // questions at once, and every answer to it is somebody's surprise.
        throw new OperatorError(
          '--shape selects the subjects to accept by what changed in them, so naming ' +
            `${flags.positionals.join(', ')} as well is asking for two different sets`,
        );
      }
      const messageFile = flags.values.get('--message-file');
      const message = flags.values.get('--message');
      if (message !== undefined && messageFile === undefined) {
        // Refused rather than ignored. `--message` with nowhere to write it is a
        // workflow that believes it recorded an explanation and did not, which is
        // exactly the failure the message exists to prevent.
        throw new OperatorError(
          '--message is the subject line of the commit message --message-file writes, and ' +
            'no --message-file was given; this command never commits anything itself',
        );
      }

      return {
        command: 'accept',
        config,
        subjects: flags.positionals,
        all,
        shapes,
        ...(messageFile !== undefined ? { messageFile: resolve(messageFile) } : {}),
        ...(message !== undefined ? { message } : {}),
      };
    }

    case 'changelog': {
      noPositionals(flags.positionals, 'changelog');
      const component = flags.values.get('--component');
      const subject = flags.values.get('--subject');
      const since = flags.values.get('--since');
      const limit = flags.values.get('--limit');

      if (limit !== undefined && !/^[1-9][0-9]*$/.test(limit)) {
        throw new OperatorError(
          `--limit is how many commits to read and must be a positive whole number, not \`${limit}\``,
        );
      }

      return {
        command: 'changelog',
        config,
        ...(component !== undefined ? { component } : {}),
        ...(subject !== undefined ? { subject } : {}),
        ...(limit !== undefined ? { limit: Number(limit) } : {}),
        ...(since !== undefined ? { since } : {}),
      };
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
 * Whether `entry` names this file, following links on both sides.
 *
 * A package manager installs a bin as a symlink — `node_modules/.bin/variance`
 * pointing here — so `process.argv[1]` is the link and `import.meta.url` is its
 * target. Compared as written they never match, and the guard below then skips
 * `main` and lets the process exit 0 without running: `npx variance run` reports
 * success having done nothing, which is the one result a gate must never invent.
 */
function isProgram(entry: string): boolean {
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

/**
 * Only when this file *is* the program.
 *
 * The guard is what lets `parseArgs` and `main` be imported by a test without the
 * import itself parsing `process.argv` and exiting the test runner.
 */
const entry = process.argv[1];
if (entry !== undefined && isProgram(entry)) {
  process.exitCode = await main(process.argv.slice(2), {
    out: (text) => process.stdout.write(text),
    err: (text) => process.stderr.write(text),
  });
}
