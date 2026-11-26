// compass: variance-authority.reach.crossings
import { OperatorError } from './exit.js';
import { noPositionals, type Flags } from './args.js';

const DAY = 86_400_000;
/** Two weeks: the window CI dashboards default to. */
export const VIEW_SINCE_DEFAULT = 14 * DAY;

export interface ParsedView {
  readonly command: 'view';
  /** `--suite`: the declared suite whose recording is read. Absent: the first that holds one. */
  readonly suite?: string;
  /** `--since`: how far back the History tab reads kept mainline records, in ms. Absent: two weeks. */
  readonly since?: number;
}

/** Parse `view`: the suite it reads, and the window of its history. */
export function parseViewArgs(flags: Flags): ParsedView {
  noPositionals(flags.positionals, 'view');
  const suite = flags.values.get('--suite');
  const since = flags.values.get('--since');
  return { command: 'view', ...(suite === undefined ? {} : { suite }), ...(since === undefined ? {} : { since: windowOf(since) }) };
}

/** `14d` or `2w`: a window in days or weeks, as ms. */
function windowOf(value: string): number {
  const match = /^([1-9][0-9]*)([dw])$/u.exec(value);
  if (match === null) throw new OperatorError(`view: --since takes days or weeks, such as 14d or 2w, not ${value}`);
  return Number(match[1]) * (match[2] === 'w' ? 7 : 1) * DAY;
}
