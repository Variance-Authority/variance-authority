import { OperatorError } from './exit.js';
import { didYouMean } from './nearest.js';

/**
 * The flag lexer: hyphens, `=`, `--`, and nothing about what any command means.
 *
 * Split out of `bin.ts` because the two halves fail differently and are read at
 * different times. The command table — which commands exist, which flags each
 * takes, what `USAGE` prints — is a statement about the product and stays where a
 * reader of the binary meets it. This file is the mechanical part: it is handed
 * the accepted set and reports what was typed, and every refusal it makes is
 * about *syntax*.
 *
 * The refusals are the reason this is hand-written at all, and the argument for
 * that is in `bin.ts` where the table it serves lives. What is worth restating
 * here is the one rule that makes the split safe: this file never decides what is
 * accepted. It is told, so a flag added to `PER_COMMAND` and nowhere else is
 * accepted, and a flag added here and nowhere else does not exist.
 */

export interface Flags {
  readonly values: Map<string, string>;
  /** Flags that appeared, valued or not. Lets `--all` be a boolean without a value. */
  readonly present: Set<string>;
  readonly positionals: readonly string[];
}

/**
 * Flags that stand alone, and the one list that says so.
 *
 * A flag missing from here is not refused — it is quietly treated as
 * value-taking, so `variance report --exit-zero-on-changes` consumes the next
 * argument or complains that nothing followed it. Exported because that failure
 * is invisible from the flag table: `PER_COMMAND` says a command accepts a flag
 * and cannot say whether it carries a value. `bin.test.ts` closes the gap by
 * reading `USAGE`, where a flag shown without a placeholder is a boolean by
 * definition.
 */
export const BOOLEAN = new Set([
  '--all',
  '--marker',
  '--flakes',
  '--publish',
  '--in-package',
  '--just-answer',
  '--no-git',
  '--whole-files',
  '--exit-zero-on-changes',
]);

/**
 * Whether these arguments ask for help rather than do anything.
 *
 * Here rather than in the parser because the question is entirely syntactic: no
 * command's flag table decides it, and the answer has to be the same for every
 * command or `--help` is a flag the operator has to look up per subcommand.
 *
 * It reads the line the way {@link readFlags} does rather than scanning it for a
 * word, because the two differ in the two places it matters. `--` ends flags, so
 * `variance accept -- --help` names a subject that starts with hyphens. And a
 * value-taking flag consumes what follows it, so `variance ask --query --help`
 * is a missing value — the refusal `readFlags` already writes — and not a
 * request for a synopsis.
 */
export function asksForHelp(argv: readonly string[]): boolean {
  let index = 0;

  while (index < argv.length) {
    const argument = argv[index] as string;
    index += 1;

    if (argument === '--') return false;
    if (argument === '--help' || argument === '-h') return true;
    if (!argument.startsWith('-')) continue;
    // An unknown flag is still refused, by `readFlags`, after this returns false.
    if (argument.includes('=') || BOOLEAN.has(argument)) continue;
    index += 1;
  }

  return false;
}

export function readFlags(
  argv: readonly string[],
  command: string,
  /** Every flag this command takes, global ones included. Refusals print it. */
  accepted: readonly string[],
  /**
   * Appended to an unknown-flag refusal: the synopsis of *this* command.
   *
   * One line rather than the whole table, because the reader has already chosen
   * the command — and the reader who cannot skim past the other fourteen is the
   * one this tool is mostly read by.
   */
  usage: string,
): Flags {
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
          `${accepted.length === 0 ? 'none' : accepted.join(', ')}` +
          `${didYouMean(name, accepted)}\n\n${usage}`,
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

    // `-` alone is stdin, by the convention every shell tool shares, and never a flag.
    if (value === undefined || (inline === undefined && value.startsWith('-') && value !== '-')) {
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

export function noPositionals(positionals: readonly string[], command: string): void {
  if (positionals.length > 0) {
    throw new OperatorError(
      `\`variance ${command}\` takes no positional arguments, and got ${positionals.join(', ')}`,
    );
  }
}

/**
 * A `--limit` is a count, and the caller says a count of what.
 *
 * Three commands take one, so the rule is here rather than restated in each:
 * `0` and `-1` are typos for a number somebody meant, and a value that parsed
 * as `NaN` and quietly became *all of them* is the reading worth refusing.
 */
export function countOf(value: string | undefined, of: string): number | undefined {
  if (value === undefined) return undefined;

  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new OperatorError(
      `--limit is how many ${of} and must be a positive whole number, not \`${value}\``,
    );
  }

  return Number(value);
}
