// compass: variance-authority.reach

/**
 * The gap a refusal leaves when a run, or a fetch, closes it: a record older
 * than the asked file (`older`), or no record at all (`unrecorded`).
 *
 * A record older than the file is a record of a commit without it: the file is
 * new, and a new file is run by reach alone. So the gap runs the files
 * `variance reach` walks to from it over imports, every one, whether the record
 * ran it or not: a new file's importers are often new tests the record never
 * saw, and those are the tests that matter. It is reach's walk, the relations
 * graph over the runtime edges, not `ask discover`'s, which reads another tree
 * and can disagree with it. Nothing names which of the files are tests, so the
 * runner runs the test files among them. Cases are counted only for the files
 * the record holds them of, and the rest are counted as files it holds none of,
 * never as zero. Then `variance index` and `variance reach --since` from the
 * record's commit take every other file the diff added since, at once. The
 * share's record predates a new file as well, so a suite given to the share is
 * walked the same way.
 *
 * No record at all is closed by the share's fetch, `variance share --suite
 * <name>`, for a suite given to the share, and otherwise by wiring the
 * producer and recording one run: that first run is the record.
 */

import type { ExecutionIndex } from '@variance-authority/sense/test-selection';
import type { ParsedCovering } from '../covering-args.js';
import type { RefusalKind } from '../exit.js';
import { gapScope, type EvidenceGap } from './evidence-gap.js';
import { declaredSuite, shareCommand } from './execution-input.js';
import { affectedFiles, refused } from './reach.js';
import { relationsFor } from './source-graph.js';

/** What a refusal knows beyond its kind. */
export interface RefusalContext {
  /** The suites none of which recorded a run, when the root declares several; otherwise the asked one, or the one it declares. */
  readonly suites?: readonly string[];
  /** The commit an `older` record was made at: the base the diff of files added since is taken from. */
  readonly commit?: string | undefined;
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
  if (request.file === undefined || request.since !== undefined || request.function !== undefined) return undefined;
  const target = request.line !== undefined ? { line: request.line } : request.lines === undefined ? undefined : { lines: request.lines };
  const scope = gapScope(request.file, target);
  if (kind === 'older') return olderGap(request, scope, whole, context.commit);
  if (kind === 'unrecorded') return unrecordedGap(request.root, scope, context.suites ?? (request.suite === undefined ? undefined : [request.suite]));
  return undefined;
}

/**
 * The gap of no record of any of `suites`, or of the one the root config
 * declares when none is named: the share's fetch of each suite given to it,
 * and one recorded run of the rest.
 */
async function unrecordedGap(root: string, scope: string, suites: readonly (string | undefined)[] | undefined): Promise<EvidenceGap> {
  const named = suites ?? [undefined];
  const fetches: string[] = [];
  const recorded: (string | undefined)[] = [];
  for (const suite of named) {
    const command = await shareCommand(root, suite);
    if (command === undefined) recorded.push(suite === undefined ? (await declaredSuite(root, undefined))?.name : suite);
    else fetches.push(command);
  }
  const suite = recorded.length === 1 ? recorded[0] : undefined;
  return {
    question: 'which tests ran it',
    scope,
    known: 'no run is recorded',
    reason: 'absent',
    remedy: 'record',
    ...(recorded.length === 0 ? {} : { run: suite === undefined ? {} : { suite } }),
    next: fetches,
  };
}

async function olderGap(request: ParsedCovering, scope: string, whole: ExecutionIndex | undefined, commit: string | undefined): Promise<EvidenceGap> {
  const file = request.file!;
  const suite = await declaredSuite(request.root, request.suite);
  const base = { question: 'which tests run it', scope, reason: 'stale', remedy: 'record' } as const;
  const next = ['variance index', ...(commit === undefined ? [] : [`variance reach --since ${commit.slice(0, 12)}`])];
  const walked = await walkFrom(request.root, file);
  if (walked === undefined) {
    return { ...base, known: 'the record predates the file, and the import walk does not hold it', next };
  }
  if (walked.length === 0) return { ...base, known: 'the record predates the file, and no file imports it', next };

  const held = new Map<string, number>();
  for (const test of whole?.tests ?? []) held.set(test.file, (held.get(test.file) ?? 0) + 1);
  const ran = walked.filter((one) => held.has(one));
  const uncounted = walked.length - ran.length;
  return {
    ...base,
    known: `the record predates the file; the import walk from it reaches ${walked.length} file${walked.length === 1 ? '' : 's'}, ${ran.length} of which the record ran`,
    run: { ...(suite === undefined ? {} : { suite: suite.name }), files: walked, walk: true },
    next,
    cost: {
      files: walked.length,
      ...(ran.length === 0 ? {} : { tests: ran.reduce((sum, one) => sum + held.get(one)!, 0) }),
      ...(uncounted === 0 ? {} : { uncounted }),
    },
  };
}

/**
 * The files `variance reach` walks to from `file` alone, the file itself left
 * out, in code-unit order: the same graph and the same walk. Absent when the
 * walk refuses, as it does for a file its graph does not hold.
 */
async function walkFrom(root: string, file: string): Promise<readonly string[] | undefined> {
  const relations = await relationsFor(root, ['.']);
  const reach = affectedFiles(relations, [file], ['.']);
  if (refused(reach)) return undefined;
  return reach.files.filter((one) => one !== file);
}
