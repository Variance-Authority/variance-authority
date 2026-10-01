import { resolve } from 'node:path';
import { noPositionals, type Flags } from './args.js';
import { REVIEW_ARTIFACT } from './commands/review-from-run.js';
import { OperatorError } from './exit.js';

export type ReviewFormat = 'text' | 'markdown' | 'json';

export interface ParsedReview {
  readonly command: 'review';
  /** Include every declared suite’s coverage, each compared with its own base. */
  readonly coverage?: true;
  /** Where the change starts. Absent: where the recording stood before the runs at this commit. */
  readonly since?: string;
  /** A case index recorded at the base, to compare the cases with. */
  readonly against?: string;
  /** A directory to write `review.json` and `review.md` into, beside what is printed. */
  readonly out?: string;
  /** The declared suite whose record is read. Required once the root config declares any. */
  readonly suite?: string;
  /** A CI run whose uploaded review is printed instead of one read from this checkout. */
  readonly fromRun?: string;
  /** The artifact `--from-run` downloads. */
  readonly artifact?: string;
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
  const suite = flags.values.get('--suite');
  const fromRun = flags.values.get('--from-run');
  const artifact = flags.values.get('--artifact');
  if (fromRun !== undefined) {
    const local = (['--since', '--against', '--suite', '--out', '--coverage'] as const).filter((flag) => flags.values.get(flag) !== undefined);
    if (local.length > 0) throw new OperatorError(`--from-run prints the review the run already made, so ${local.join(' and ')} has nothing to change in it`);
  } else if (artifact !== undefined) {
    throw new OperatorError('--artifact names what `--from-run` downloads, and no `--from-run` was given');
  }
  return {
    command: 'review',
    ...(flags.present.has('--coverage') ? { coverage: true as const } : {}),
    ...(since === undefined ? {} : { since }),
    ...(against === undefined ? {} : { against: resolve(against) }),
    ...(out === undefined ? {} : { out: resolve(out) }),
    ...(suite === undefined ? {} : { suite }),
    ...(fromRun === undefined ? {} : { fromRun, artifact: artifact ?? REVIEW_ARTIFACT }),
    root: resolve(flags.values.get('--root') ?? process.cwd()),
    format,
  };
}
