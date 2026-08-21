import { writeFile } from 'node:fs/promises';
import {
  changelogOf,
  isRecorded,
  renderCommitMessage,
  type ChangelogSelection,
} from '@variance-authority/report';
import type { AcceptResult } from './accept.js';
import type { CliRunReport } from './run.js';

/**
 * The commit message a baseline update carries, written to a file.
 *
 * Where baselines are files in the repository, the commit *is* the store, and
 * the message is the only place an explanation can go that survives the CI job
 * that produced it. So `accept` can be asked to write one: prose for the reviewer
 * scrolling `git log`, trailers for the reader a month later who wants the run id
 * and the shapes rather than a paragraph.
 *
 * A file rather than stdout, and a file rather than `accept` committing anything
 * itself. Committing would put a `git` and a branch policy inside the command
 * whose entire safety argument is that it only promotes images the run already
 * produced; writing a file leaves the decision of whether to commit — and to
 * which branch, as whom, after which checks — with the workflow that already owns
 * it. `git commit -F` is the other half, and it is one line of shell.
 *
 * ## When nothing is written
 *
 * A refusal from `changelogOf` — nothing was accepted, or the report cannot name
 * its run — returns the sentence rather than writing a file with a hole in it. The
 * caller prints it and the workflow's `git diff --cached --quiet` is what decides
 * whether there was anything to commit anyway. Writing a message describing an
 * update that did not happen is the one outcome that would make the log worse
 * than no log.
 */

export interface AcceptMessageOptions {
  readonly report: CliRunReport;
  readonly result: AcceptResult;
  /** How the operator chose the subjects, which is how much review this update had. */
  readonly selection: ChangelogSelection;
  /** Where to write it. The workflow passes the same path to `git commit -F`. */
  readonly path: string;
  /** The subject line, unchanged. The operator's, not this tool's. */
  readonly message: string;
  readonly project?: string;
  /** ISO 8601. Injected, because nothing written into a record may come from a hidden clock. */
  readonly at: string;
}

/**
 * Write the message, or say why there is none.
 *
 * Returns the sentence to print in either case, because both are worth a line:
 * an operator who passed `--message-file` and got no file needs to know before
 * their next step tries to commit with it.
 */
export async function writeAcceptMessage(options: AcceptMessageOptions): Promise<string> {
  const record = changelogOf({
    report: options.report,
    accepted: options.result.accepted.map((entry) => entry.subject),
    selection: options.selection,
    at: options.at,
    ...(options.project !== undefined ? { project: options.project } : {}),
  });

  if (!isRecorded(record)) {
    return `no commit message was written to ${options.path}: ${record.because}`;
  }

  await writeFile(options.path, renderCommitMessage({ message: options.message, record }), 'utf8');
  return (
    `wrote a commit message describing ${String(record.entries.length)} change(s) to ` +
    `${options.path}; commit the baselines with \`git commit -F ${options.path}\``
  );
}
