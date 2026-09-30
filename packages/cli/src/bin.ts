#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { closeSync, openSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { isCI } from 'ci-info';
import { messageOf } from './config-values.js';
import { EXIT_CLEAN, EXIT_OPERATOR, isOperatorError, type ExitCode } from './exit.js';
import { dispatch } from './dispatch.js';
import { settleFollowUps, type Detach } from './commands/index-command.js';
import { CLI_VERSION } from './version.js';
import { USAGE, parseArgs, type Parsed } from './parse.js';
import { helpFor } from './usage.js';
import { skillLine } from './skill.js';

/**
 * The program: one command in, one exit code out.
 *
 * What a command *means* — which ones exist, which flags each takes, and what a
 * reader who gets one wrong is shown — is in [`parse.ts`](./parse.ts). What is
 * left here is the part that touches the process: the two ways a failure can
 * print, and the guard that decides whether this file is being run or imported.
 * They change for different reasons, and only one of them is a statement about
 * the product.
 */

export { USAGE, parseArgs, type Parsed } from './parse.js';

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
  streams: { out(text: string): void; err(text: string): void; detach?: Detach },
): Promise<ExitCode> {
  let parsed: Parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    streams.err(`${messageOf(error)}\n${skillLine()}`);
    return EXIT_OPERATOR;
  }

  if (parsed.command === 'version') {
    streams.out(`${CLI_VERSION}\n`);
    return EXIT_CLEAN;
  }

  if (parsed.command === 'help') {
    // The whole table only when no command was named. Help asked about one
    // command answers about that command — and either way this is what was
    // asked for, so it is exit 0 rather than the 2 a refusal would carry.
    streams.out(`${parsed.topic === undefined ? USAGE : helpFor(parsed.topic)}\n`);
    return EXIT_CLEAN;
  }

  try {
    await settleFollowUps(parsed, streams);
    return await dispatch(parsed, streams);
  } catch (error) {
    if (isOperatorError(error)) {
      streams.err(`${messageOf(error)}\n${skillLine()}`);
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
 * `main` and lets the process exit 0 without running: `variance run` reports
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
    // A CI job ends with its last step and saves its cache after it, so there
    // nothing is left running: the step is the log, and the log is whole.
    ...(isCI ? {} : { detach: relaunch }),
  });
}

/**
 * This program again, as a process of its own that outlives this one, writing to
 * `log`. Only the program can hand this over, because only it knows what to run:
 * `main` called by a library has no process to relaunch, and does the work itself.
 */
function relaunch(argv: readonly string[], log: string): number | undefined {
  const out = openSync(log, 'w');
  try {
    const child = spawn(process.execPath, [...process.execArgv, fileURLToPath(import.meta.url), ...argv], {
      detached: true,
      stdio: ['ignore', out, out],
    });
    child.unref();
    return child.pid;
  } finally {
    closeSync(out);
  }
}
