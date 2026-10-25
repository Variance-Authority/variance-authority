// compass: variance-authority.reach

/**
 * The gap a refusal leaves when a run, or a fetch, closes it: a record older
 * than the asked file (`older`), or no record at all (`unrecorded`).
 *
 * Neither is closed by running the suite again over a record that exists. A
 * suite given to the share (`"carry": "share"`) has the mainline's record
 * fetched instead, by `variance share --suite <name>`: for `unrecorded` always,
 * and for `older` when the mainline holds the file, which is when its record
 * can. Otherwise `older` runs the test files that record ran that reach the
 * file by import, as `variance ask discover --to <file>` finds them, nearest
 * first, and costs those. When none reaches it, the gap says so and runs
 * nothing: a test file the record never ran is not this suite's evidence, and
 * the suite whole is not the remedy. `unrecorded` outside the share wires the
 * producer and records one run, since that first run is the record.
 *
 * The mainline is the one `share` reads against, and it holds the file when
 * `HEAD`'s merge base with it does: git answers that from this clone.
 */

import { existedAt } from '@variance-authority/sense';
import type { ExecutionIndex } from '@variance-authority/sense/test-selection';
import type { ParsedCovering } from '../covering-args.js';
import type { RefusalKind } from '../exit.js';
import { readerMainline } from '../share-lines.js';
import { discoverFiles } from './ask-source.js';
import { gapScope, type EvidenceGap } from './evidence-gap.js';
import { declaredSuite, shareCommand } from './execution-input.js';
import { rootShare } from './mainline-base.js';

/**
 * The gap of a refusal `kind` of a question about one file, a line or a run of
 * them, when a run closes it. `whole` is the record, when one was read: its
 * test files are the ones `older` may run, and it counts their cases.
 * `suites` are the ones none of which recorded a run, when the root declares
 * several; otherwise the asked one, or the one it declares.
 */
export async function refusalGap(
  kind: RefusalKind | undefined,
  request: ParsedCovering,
  whole: ExecutionIndex | undefined,
  suites?: readonly string[],
): Promise<EvidenceGap | undefined> {
  if (request.file === undefined || request.since !== undefined || request.function !== undefined) return undefined;
  const target = request.line !== undefined ? { line: request.line } : request.lines === undefined ? undefined : { lines: request.lines };
  const scope = gapScope(request.file, target);
  if (kind === 'older') return olderGap(request, scope, whole);
  if (kind === 'unrecorded') return unrecordedGap(request.root, scope, suites ?? (request.suite === undefined ? undefined : [request.suite]));
  return undefined;
}

/**
 * The gap of no record of any of `suites`, or of the one the root config
 * declares when none is named: the share's fetch of each suite given to it,
 * and one recorded run of the rest.
 */
export async function unrecordedGap(root: string, scope: string, suites: readonly (string | undefined)[] | undefined): Promise<EvidenceGap> {
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
    gear: 'record',
    ...(recorded.length === 0 ? {} : { run: suite === undefined ? {} : { suite } }),
    next: fetches,
  };
}

async function olderGap(request: ParsedCovering, scope: string, whole: ExecutionIndex | undefined): Promise<EvidenceGap> {
  const file = request.file!;
  const suite = await declaredSuite(request.root, request.suite);
  const share = suite?.carry === 'share' ? await mainlineHolds(request.root, file) : undefined;
  const base = { question: 'which tests run it', scope, reason: 'stale', gear: 'record' } as const;
  if (share === true) {
    return {
      ...base,
      known: 'the record predates the file, and the mainline holds it, so its record holds the file once the mainline has recorded since',
      next: [`variance share --suite ${suite!.name}`],
    };
  }
  const predates = share === false ? 'the record predates the file, which the mainline does not hold yet' : 'the record predates the file';
  const ran = new Map<string, number>();
  for (const test of whole?.tests ?? []) ran.set(test.file, (ran.get(test.file) ?? 0) + 1);
  const files = (await discoverFiles(request.root, { to: [file] }).catch(() => [])).filter((one) => ran.has(one));
  if (files.length === 0) {
    return { ...base, known: `${predates}, and no test file it ran reaches the file by import`, next: [`variance ask discover --to ${file}`] };
  }
  return {
    ...base,
    known: `${predates}; ${files.length} test file${files.length === 1 ? '' : 's'} it ran ${files.length === 1 ? 'reaches' : 'reach'} the file by import`,
    run: { ...(suite === undefined ? {} : { suite: suite.name }), files },
    next: [],
    cost: { tests: files.reduce((sum, one) => sum + ran.get(one)!, 0), files: files.length },
  };
}

/**
 * Whether the mainline `share` reads against holds `file`: `HEAD`'s merge base
 * with it does. Absent when this clone names no mainline, or cannot say.
 */
async function mainlineHolds(root: string, file: string): Promise<boolean | undefined> {
  const selection = await import('@variance-authority/sense/test-selection');
  let share: ReturnType<typeof rootShare>;
  try {
    share = rootShare(selection.rootConfig(root));
  } catch {
    return undefined;
  }
  const chosen = await readerMainline(share === undefined ? {} : { share }, process.env, root);
  if ('missing' in chosen || chosen.base === undefined) return undefined;
  const held = existedAt(root, chosen.base, file);
  return typeof held === 'boolean' ? held : undefined;
}
