import { resolve } from 'node:path';
import type { Flags } from './args.js';
import { OperatorError } from './exit.js';

export interface ParsedComment {
  readonly command: 'comment';
  readonly config: string;
  readonly bodyFile?: string;
  readonly runUrl?: string;
  /** `--to-accept`: how a reviewer accepts in this repository, in the operator's words. */
  readonly toAccept?: string;
  readonly marker: boolean;
  /** Reports to read instead of the configured one. More than one is merged. */
  readonly reports: readonly string[];
}

export function parseCommentArgs(flags: Flags, config: string): ParsedComment {
  const bodyFile = flags.values.get('--body-file');
  // An empty value is the workflow's "the operator set nothing", which must read
  // as absent rather than as a link to '' or an instruction that says nothing.
  const runUrl = flags.values.get('--run-url') || undefined;
  const toAccept = flags.values.get('--to-accept') || undefined;
  const marker = flags.present.has('--marker');

  if (
    marker &&
    (bodyFile !== undefined || runUrl !== undefined || toAccept !== undefined || flags.positionals.length > 0)
  ) {
    // Two different questions, and answering both at once would mean deciding
    // which one the exit code is about. `--marker` is a constant this build
    // carries; the body is a reading of a report that may not exist yet.
    throw new OperatorError(
      '`--marker` prints the marker and nothing else; it does not take --body-file, ' +
        '--run-url, --to-accept or a report',
    );
  }

  return {
    command: 'comment',
    config,
    marker,
    ...(bodyFile !== undefined ? { bodyFile } : {}),
    ...(runUrl !== undefined ? { runUrl } : {}),
    ...(toAccept !== undefined ? { toAccept } : {}),
    reports: flags.positionals.map((path) => resolve(path)),
  };
}
