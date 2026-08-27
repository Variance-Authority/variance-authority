import { parseCommitMessage, type ChangelogRecord } from '@variance-authority/report';
import { resolve } from 'node:path';
import { runCommand, type CommandRunner } from './lfs.js';

/**
 * Reading baseline updates back out of the repository that holds them.
 *
 * The write half is a commit message ([`report`](../../report/src/changelog-message.ts)).
 * This is the other direction, and it exists because a record nothing can read is
 * a record nobody keeps: the whole argument for putting the explanation in the
 * commit is that the explanation outlives the CI job, and outliving it means
 * being findable a month later by somebody asking *why does this baseline look
 * like this*.
 *
 * It lives in this package because `git` is already this package's requirement
 * and its only shell-out, and beside the LFS store because that is the backend
 * whose baselines are commits at all. A directory store in a repository answers
 * here too, which is correct — where the bytes are committed is what decides
 * whether a commit explains them, and that is a property of the checkout rather
 * than of the store object.
 *
 * ## What it refuses to answer with
 *
 * An empty list is a real answer only when git ran, this is a repository, and no
 * commit under the baseline root carried a record. Every other case — git absent,
 * not a repository, a revision that does not resolve — is a **sentence**, because
 * "no baseline has ever been explained" and "nobody could ask" are opposite
 * findings and an operator acting on the first would go looking for a bug in the
 * writer.
 *
 * A **shallow clone** is the one that would otherwise pass silently. CI checks
 * out at depth 1 by default, so a reading there sees one commit and reports it as
 * the whole history of a baseline. That is not refused — one commit is still an
 * answer — but the reading says it was bounded, and by what.
 */

/** The answer when no record could be read at all. */
export interface Unreadable {
  readonly read: false;
  /** One sentence, ready to print. Names what could not be asked, never "no changes". */
  readonly because: string;
}

/** One commit that carried a baseline update. */
export interface ChangelogCommit {
  /** The commit the update landed in — the child of the one the run observed. */
  readonly sha: string;
  /** Author date, ISO 8601, as git reports it. */
  readonly at: string;
  readonly record: ChangelogRecord;
}

export interface ChangelogHistory {
  /** Newest first, as `git log` orders them. */
  readonly commits: readonly ChangelogCommit[];

  /**
   * What this reading could not see, when something bounded it. Empty means whole.
   *
   * A list rather than a flag because the bounds compose: a shallow clone, a
   * commit whose trailer no reader here understands, and a limit the log filled
   * are three different reasons an answer is a lower bound, and a reader deciding
   * whether to trust a total needs to know which.
   */
  readonly bounded: readonly string[];
}

export type ChangelogAnswer = ChangelogHistory | Unreadable;

/** Narrow an answer to a real one. */
export function wasRead(answer: ChangelogAnswer): answer is ChangelogHistory {
  return (answer as { readonly read?: unknown }).read !== false;
}

export interface ChangelogHistoryOptions {
  /**
   * The baseline root. Only commits that touched a path under it are read.
   *
   * The filter is what keeps this cheap and what keeps it honest: a repository's
   * ordinary commits are not baseline updates, and scanning them for trailers
   * would spend the whole log to find the same answer.
   *
   * A relative path is read against {@link ChangelogHistoryOptions.cwd} when one
   * is given, and against the calling process's directory when none is — the
   * same directory `createDurableStore` would have read it against.
   */
  readonly root: string;

  /** Where to run git. Defaults to {@link ChangelogHistoryOptions.root}. */
  readonly cwd?: string;

  /**
   * Commits to read. Defaults to 200.
   *
   * A cap rather than a whole history, because the question this answers is
   * always *recently* — and a reading that filled its cap says so in `bounded`
   * rather than presenting a window as a total.
   */
  readonly limit?: number;

  /**
   * A revision to read forward from, exclusive — a tag, a branch, a sha.
   *
   * Passed to git as `<since>..HEAD`, so a revision that does not resolve is a
   * refusal naming it, never an empty answer.
   */
  readonly since?: string;

  /** How git is run. Injected so this is testable without a repository. */
  readonly git?: CommandRunner;
}

/** Field and record separators. Control characters, so no commit message contains them. */
const FIELD = '\u001e';
const RECORD = '\u001f';

const DEFAULT_LIMIT = 200;

/**
 * Every baseline update recorded under a root, newest first.
 *
 * One `git log`, formatted so the parse is a split rather than a scrape. The
 * decorated formats a person reads — `medium`, `full` — indent the body by four
 * spaces, which would put every trailer behind whitespace; `%B` is the raw
 * message and is what the writer wrote.
 */
export async function readChangelog(options: ChangelogHistoryOptions): Promise<ChangelogAnswer> {
  const cwd = options.cwd ?? options.root;
  // Absolute, because git reads a relative pathspec against the directory it was
  // run in — and by default that directory is the root itself, so a relative root
  // asked about `<root>/<root>` and found nothing there. Which is the fifth way to
  // produce no commits, and the only one that looked like an answer: git ran, the
  // checkout was a repository, the baseline commit was right there, and the
  // reading said the baselines had never been explained.
  const under = resolve(options.cwd ?? process.cwd(), options.root);
  const git = options.git ?? runCommand;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const bounded: string[] = [];

  const shallow = await ask(git, cwd, ['rev-parse', '--is-shallow-repository']);
  if (!shallow.ok) return shallow.answer;
  if (shallow.stdout.trim() === 'true') {
    bounded.push(
      'this is a shallow clone, so the log holds only the commits it was fetched with; a ' +
        'baseline updated before then is explained by a commit that is not here. ' +
        '`actions/checkout` fetches depth 1 unless told otherwise',
    );
  }

  const log = await ask(git, cwd, [
    'log',
    '--format=%H%x1e%aI%x1e%B%x1f',
    `--max-count=${String(limit)}`,
    ...(options.since === undefined ? [] : [`${options.since}..HEAD`]),
    '--',
    under,
  ]);
  if (!log.ok) return log.answer;

  const commits: ChangelogCommit[] = [];
  const raw = log.stdout.split(RECORD).filter((chunk) => chunk.trim() !== '');

  for (const chunk of raw) {
    const [sha = '', at = '', message = ''] = chunk.replace(/^\n/, '').split(FIELD);
    let record: ChangelogRecord | undefined;
    try {
      record = parseCommitMessage(message);
    } catch (error) {
      // Named and skipped rather than fatal. One commit written by a newer or a
      // broken writer must not take the other 199 with it — but a silent skip
      // would make the answer a lower bound with nothing saying so, which is the
      // failure this whole subsystem exists to refuse.
      bounded.push(
        `commit ${sha.slice(0, 12)} carries a record this reader could not use: ` +
          `${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (record !== undefined) commits.push({ sha, at, record });
  }

  if (raw.length >= limit) {
    bounded.push(
      `the reading stopped at ${String(limit)} commit(s) under \`${options.root}\`, which is the ` +
        'limit it was given; there may be older updates',
    );
  }

  return { commits, bounded };
}

type Asked =
  | { readonly ok: true; readonly stdout: string }
  | { readonly ok: false; readonly answer: Unreadable };

/**
 * Ask git one thing, with the two failures kept apart.
 *
 * A spawn failure is a fact about the machine; a non-zero exit is git's answer
 * about this directory. Collapsing them would report a missing tool as an empty
 * history, which is the one thing this module may not do.
 */
async function ask(git: CommandRunner, cwd: string, args: readonly string[]): Promise<Asked> {
  let result;
  try {
    result = await git('git', args, { cwd });
  } catch (error) {
    return {
      ok: false,
      answer: {
        read: false,
        because:
          'git could not be run on this machine, so no baseline update could be read ' +
          `(${error instanceof Error ? error.message : String(error)}). Where baselines are ` +
          'commits, git is the record; this is not the answer that none exists',
      },
    };
  }

  if (result.code !== 0) {
    return {
      ok: false,
      answer: {
        read: false,
        because:
          `git refused \`${args.join(' ')}\` in ${cwd}: ` +
          `${result.stderr.trim().split('\n')[0] ?? `exit ${String(result.code)}`}`,
      },
    };
  }

  return { ok: true, stdout: result.stdout };
}
