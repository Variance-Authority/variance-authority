// compass: variance-authority.reach
import type { Flags } from './args.js';

export interface ParsedCargo {
  readonly command: 'cargo';
  /** The suite the tests are recorded under; absent, the only one declared. */
  readonly suite?: string;
  /** What follows `--`, handed to `cargo test`: the packages, features and targets to build. */
  readonly args: readonly string[];
}

/** `cargo [--suite <name>] [-- <cargo test argument>...]`. */
export function parseCargoArgs(flags: Flags): ParsedCargo {
  const suite = flags.values.get('--suite');
  return { command: 'cargo', ...(suite === undefined ? {} : { suite }), args: flags.positionals };
}
