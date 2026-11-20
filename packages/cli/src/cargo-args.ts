// compass: variance-authority.reach
import type { Flags } from './args.js';
import { OperatorError } from './exit.js';

export interface ParsedCargo {
  readonly command: 'cargo';
  /** The suite the tests are recorded under; absent, the only one declared. */
  readonly suite?: string;
  /** What follows `--`, handed to `cargo test`: the packages, features and targets to build. */
  readonly args: readonly string[];
}

/** The `cargo test` options that take a value as the next argument; the one bare argument it takes otherwise is a test filter. */
const valued = new Set(['-p', '--package', '--exclude', '--test', '--bench', '--bin', '--example', '-F', '--features', '-j', '--jobs', '--target', '--target-dir', '--artifact-dir', '--manifest-path', '--lockfile-path', '--message-format', '--color', '--config', '-Z', '--profile']);

/** `cargo [--suite <name>] [-- <cargo test argument>...]`. */
export function parseCargoArgs(flags: Flags): ParsedCargo {
  const suite = flags.values.get('--suite');
  if (flags.positionals.includes('--')) {
    throw new OperatorError('`variance cargo` runs every test the build lists and records each, so it takes no test filter or libtest flag after a second `--`');
  }
  const filter = flags.positionals.find((arg, at) => !arg.startsWith('-') && !valued.has(flags.positionals[at - 1] ?? ''));
  if (filter !== undefined) throw new OperatorError(`\`variance cargo\` runs every test the build lists and records each, so it takes no test filter: ${filter}`);
  return { command: 'cargo', ...(suite === undefined ? {} : { suite }), args: flags.positionals };
}
