/**
 * The half of `variance reach` with a git process, a scan and a disk in it.
 *
 * The decision is next door in [`reach.ts`](./reach.ts), which every other
 * caller of the graph walk already shares. This is what has to happen before it
 * can be asked: take the diff, scan the tree, and split the changed paths into
 * the ones a reader claims and the ones no reader was ever going to open.
 *
 * ## The answer goes on a command line
 *
 * Every other command here prints for a person. This one prints for `xargs`,
 * and that inverts the failure. A selector that says *skip nothing* costs a full
 * suite; a list that says *run nothing* is an empty pipe, a green build in
 * forty seconds, and a change nobody looked at. So stdout carries paths and
 * only paths, everything a person needs goes to stderr, and every reading that
 * cannot produce a list is an operator error rather than a short one — the
 * refusals in [`reach.ts`](./reach.ts) plus the empty diff below.
 *
 * On exit `0`, stdout is never empty. It holds by construction rather than by
 * check: `affectedBy` returns the seeds among the files it reached, so an answer
 * that got past the refusals holds at least the changed files themselves.
 *
 * ## A path no reader claims
 *
 * A lockfile, a Dockerfile, a workflow, a `.json` somebody generates from. The
 * graph was never going to hold it, and refusing the whole diff because one
 * changed would make the command useless on the commits people actually push.
 * They are taken out before the walk and named on stderr, so an operator can
 * see the part of their diff this answer is not about. A diff that is *entirely*
 * such paths still refuses, because then there is nothing left to be about.
 */

import { OperatorError } from '../exit.js';
import { affectedFiles, refused } from './reach.js';
import { relationsFor } from './source-graph.js';
import { changedSince } from './since.js';

/** How the file list is written. `plain` is what a pipe wants. */
export type ReachFormat = 'plain' | 'json';

/** What `variance reach` was asked for, once the flags are off the command line. */
export interface ReachRequest {
  readonly cwd: string;
  /** `--since <ref>`: the ref the diff is taken against. Required; there is no default. */
  readonly since: string;
  readonly format: ReachFormat;
  readonly noGit?: boolean;
}

/**
 * The two streams, kept apart by the caller that writes them.
 *
 * The same shape `select` returns, for the same reason and with more riding on
 * it: `out` is substituted into somebody's command line, so nothing that
 * explains the answer may reach it.
 */
export interface ReachOutput {
  /** Paths, and nothing else. */
  readonly out: string;
  /** Everything a person needs and no runner may parse. */
  readonly err: string;
}

/** Walk the file graph from a diff, and say what it reaches. */
export async function reachOutput(request: ReachRequest): Promise<ReachOutput> {
  const changed = await changedSince(request.since);
  if (changed.length === 0) {
    throw new OperatorError(
      `nothing has changed since \`${request.since}\`, so there is nothing to walk from. A run ` +
        'list is not the answer to an empty diff — an empty one would read as `run nothing`, ' +
        'and a whole checkout would read as `run everything`; neither is what you asked.',
    );
  }

  const relations = await relationsFor(request.cwd, ['.'], [], [], {
    why: '`reach` answers from the file graph',
    fix: 'Install `@variance-authority/sense`, which is what reads the tree.',
  }, request.noGit);
  const { READABLE } = await import('@variance-authority/sense');

  const readable = changed.filter((file) => READABLE.has(suffixOf(file)));
  const unread = changed.filter((file) => !READABLE.has(suffixOf(file)));

  const reach = affectedFiles(relations, readable, ['.']);
  if (refused(reach)) {
    throw new OperatorError(
      `${reach.whole}. Rather than print a file list this cannot stand behind, \`reach\` stops ` +
        'here: a short list piped into a runner is a green build over a change nobody read.',
    );
  }

  const notes = [
    reach.how,
    ...(unread.length === 0
      ? []
      : [
          `${unread.length} changed ${unread.length === 1 ? 'path is' : 'paths are'} in no ` +
            `language this build reads and ${unread.length === 1 ? 'was' : 'were'} left out of ` +
            `the walk: ${unread.join(', ')}`,
        ]),
    ...reach.opaque.map((hole) =>
      hole.because === undefined
        ? `${hole.file} was traversed as changed: its own imports could not be read`
        : `${hole.file} was traversed as changed: ${hole.because}`),
  ];

  return {
    out:
      request.format === 'json'
        ? `${JSON.stringify(
            {
              since: request.since,
              changed: [...changed],
              unread,
              seeded: reach.seeded,
              files: reach.files,
            },
            undefined,
            2,
          )}\n`
        : `${reach.files.join('\n')}\n`,
    err: `${notes.join('\n')}\n`,
  };
}

/** The whole suffix, in the spelling `languageOf` is keyed by. */
function suffixOf(path: string): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const dot = name.lastIndexOf('.');
  return dot <= 0 ? '' : name.slice(dot);
}
