import { resolve } from 'node:path';
import { noPositionals, type Flags } from './args.js';
import { OperatorError } from './exit.js';

export type ReviewFormat = 'text' | 'markdown' | 'json';

export interface ParsedReview {
  readonly command: 'review';
  /** Where the change starts. Absent: where the recording stood before the runs at this commit. */
  readonly since?: string;
  /** A case index recorded at the base, to compare the cases with. */
  readonly against?: string;
  /** A directory to write `review.json` and `review.md` into, beside what is printed. */
  readonly out?: string;
  readonly root: string;
  readonly format: ReviewFormat;
}

export function parseReviewArgs(flags: Flags): ParsedReview {
  noPositionals(flags.positionals, 'review');
  const format = flags.values.get('--format') ?? 'text';
  if (format !== 'text' && format !== 'markdown' && format !== 'json') {
    throw new OperatorError(`--format must be text, markdown or json, not \`${format}\``);
  }
  const since = flags.values.get('--since');
  const against = flags.values.get('--against');
  const out = flags.values.get('--out');
  return {
    command: 'review',
    ...(since === undefined ? {} : { since }),
    ...(against === undefined ? {} : { against: resolve(against) }),
    ...(out === undefined ? {} : { out: resolve(out) }),
    root: resolve(flags.values.get('--root') ?? process.cwd()),
    format,
  };
}
