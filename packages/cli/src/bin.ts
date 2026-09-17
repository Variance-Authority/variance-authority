#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { messageOf } from './config-values.js';
import { EXIT_CLEAN, EXIT_OPERATOR, isOperatorError, type ExitCode } from './exit.js';
import { dispatch } from './dispatch.js';
import { CLI_VERSION } from './version.js';
import { USAGE, parseArgs, type Parsed } from './parse.js';
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
  streams: { out(text: string): void; err(text: string): void },
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
    streams.out(`${USAGE}\n`);
    return EXIT_CLEAN;
  }

  try {
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
  });
}
