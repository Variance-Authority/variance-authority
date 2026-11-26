// compass: variance-authority.reach.crossings
import { noPositionals, type Flags } from './args.js';

export interface ParsedView {
  readonly command: 'view';
  /** `--suite`: the declared suite whose recording is read. Absent: the first that holds one. */
  readonly suite?: string;
}

/** Parse `view`: the suite it reads. */
export function parseViewArgs(flags: Flags): ParsedView {
  noPositionals(flags.positionals, 'view');
  const suite = flags.values.get('--suite');
  return { command: 'view', ...(suite === undefined ? {} : { suite }) };
}
