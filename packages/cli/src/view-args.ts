// compass: variance-authority.reach.crossings
import { noPositionals, type Flags } from './args.js';

export interface ParsedView {
  readonly command: 'view';
  /** `--suite`: the declared suite whose recording is read. Absent: the first that holds one. */
  readonly suite?: string;
  /** `--out`: where the page is written. Absent: `variance-view.html` in the cache. */
  readonly out?: string;
}

/** Parse `view`: the suite it reads and where it writes. */
export function parseViewArgs(flags: Flags): ParsedView {
  noPositionals(flags.positionals, 'view');
  const suite = flags.values.get('--suite');
  const out = flags.values.get('--out');
  return { command: 'view', ...(suite === undefined ? {} : { suite }), ...(out === undefined ? {} : { out }) };
}
