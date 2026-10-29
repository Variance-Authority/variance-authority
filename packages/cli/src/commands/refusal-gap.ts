// compass: variance-authority.reach

/**
 * The gap a refusal leaves when a run, or a fetch, closes it: a record older
 * than the asked file (`older`), or no record at all (`unrecorded`).
 *
 * A record older than the file is a record of a commit without it: the file is
 * new, and a new file is run by reach. Selection owns that answer, under the
 * suite's own `relations`, `ignore` and `before` (`gap-selection.ts`), so the
 * gap runs the recorded test files selection names for it, or the whole suite
 * when selection does, and no run when it names none. A test file added with
 * it is in no record, and reach owns it: `variance reach --since` from the
 * record's commit takes every file the diff added since, at once. A lookup
 * selection refuses leaves the refusal standing, its gap saying why in
 * selection's words. The share's record predates a new file as well,
 * so a suite given to the share is asked the same way.
 *
 * No record at all is closed by the share's fetch, `variance share --suite
 * <name>`, for a suite given to the share, and otherwise by wiring the
 * producer and recording one run: that first run is the record.
 */

import type { ExecutionIndex } from '@variance-authority/sense/test-selection';
import type { ParsedCovering } from '../covering-args.js';
import type { RefusalKind } from '../exit.js';
import { gapScope, selectionRun, type EvidenceGap } from './evidence-gap.js';
import { declaredSuite, shareCommand } from './execution-input.js';
import { graphOnce, selectedFor, type Graph } from './gap-selection.js';

/** What a refusal knows beyond its kind. */
export interface RefusalContext {
  /** The commit an `older` record was made at: the base the diff of files added since is taken from. */
  readonly commit?: string | undefined;
  /** The record an `older` refusal was read from, which selection is asked about. */
  readonly record?: string | undefined;
  /** The file graph the invocation already reads, so selection is asked over the same one. */
  readonly graph?: Graph;
}

/**
 * The gap of a refusal `kind` of a question about one file, a line or a run of
 * them, when a run closes it. `whole` is the record, when one was read: it
 * counts the cases of the files the run takes.
 */
export async function refusalGap(
  kind: RefusalKind | undefined,
  request: ParsedCovering,
  whole: ExecutionIndex | undefined,
  context: RefusalContext = {},
): Promise<EvidenceGap | undefined> {
  // FIXME: a `--since` or `--function` refusal ends with no gap; it should end with its Record one.
  if (request.file === undefined || request.since !== undefined || request.function !== undefined) return undefined;
  const target = request.line !== undefined ? { line: request.line } : request.lines === undefined ? undefined : { lines: request.lines };
  const scope = gapScope(request.file, target);
  if (kind === 'older') return olderGap(request, scope, whole, context, context.graph ?? graphOnce(request.root));
  if (kind === 'unrecorded') return unrecordedGap(request.root, scope, request.suite);
  return undefined;
}

/**
 * The gap of no record of `suite`, or of the one the root config declares when
 * none is named: the share's fetch when the suite is given to it, and otherwise
 * one recorded run. Several suites with no record each give theirs, and the
 * answer of every suite joins them (`covering-suites.ts`).
 */
async function unrecordedGap(root: string, scope: string, suite: string | undefined): Promise<EvidenceGap> {
  const fetch = await shareCommand(root, suite);
  const name = suite ?? (await declaredSuite(root, undefined))?.name;
  return {
    question: 'which tests ran it',
    scope,
    known: 'no run is recorded',
    reason: 'absent',
    remedy: 'record',
    ...(fetch === undefined ? { run: name === undefined ? {} : { suite: name } } : {}),
    next: fetch === undefined ? [] : [fetch],
  };
}

async function olderGap(
  request: ParsedCovering,
  scope: string,
  whole: ExecutionIndex | undefined,
  { commit, record }: RefusalContext,
  graph: Graph,
): Promise<EvidenceGap> {
  const suite = (await declaredSuite(request.root, request.suite))?.name;
  const source = { root: request.root, suite: request.suite, execution: request.execution, record, graph };
  const selected = await selectedFor(source, request.file!);
  const { said, joint, run, cost } = selectionRun(selected, suite, whole);
  const reach = commit === undefined ? [] : [`variance reach --since ${commit.slice(0, 12)}`];
  return {
    question: 'which tests run it',
    scope,
    known: `the record predates the file${joint}${said}`,
    reason: 'stale',
    remedy: 'record',
    ...(run === undefined ? {} : { run }),
    next: reach,
    ...(cost === undefined ? {} : { cost }),
  };
}
