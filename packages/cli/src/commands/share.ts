import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  firstShared,
  httpShare,
  neverFails,
  shareKey,
  type SharedCache,
} from '@variance-authority/core/share';
import type { RunReport } from '@variance-authority/report';
import { readSuiteIndex, writeSuiteIndex } from '@variance-authority/report/file';
import {
  decodeSuiteIndex,
  encodeSuiteIndex,
  suiteIndexOf,
  type SuiteIndex,
} from '@variance-authority/report/suite-index';
import { createDirectoryShare } from '@variance-authority/store/share';
import type { Config } from '../config.js';
import { suiteIndexRoot } from './resources.js';
import { readCliRunReport } from './run.js';

/**
 * Publishing and fetching a mainline evaluation — the CLI half of the seam.
 *
 * `@variance-authority/core/share` knows how to put bytes somewhere and find
 * them again; `@variance-authority/report` knows what a suite index is. This
 * module is the only place that knows both, plus the two things neither can
 * know: which commits this checkout descends from, and where on this machine an
 * index is kept.
 *
 * ## Everything here swallows its failures
 *
 * Not one function below can fail a run. A publish that could not reach a
 * bucket, a `git` that is not installed, a repository with no history, an index
 * from a writer this version does not understand — every one of them is the same
 * outcome as never having configured a share, which is the outcome the product
 * had before this existed and is still a correct one. What is lost is time.
 *
 * The cost of that, stated rather than hidden: an operator whose share is
 * broken sees a slow pipeline and no message. The one number that tells them is
 * how far back the hit was, which is why {@link MainlineIndex} carries it and
 * why the CLI prints it.
 */

const run = promisify(execFile);

/** The artifact name a suite index is published under. Carries its version. */
const SUITE_INDEX = 'suite-index-v1';

const DEFAULT_MAINLINE = 'origin/main';
const DEFAULT_DEPTH = 50;

/** The share a config names, or nothing at all. */
export function shareFor(config: Config): SharedCache | undefined {
  const share = config.share;
  if (share === undefined) return undefined;

  if (share.kind === 'http') {
    return neverFails(
      httpShare({
        endpoint: share.endpoint,
        ...(share.method !== undefined ? { method: share.method } : {}),
        ...(share.token !== undefined ? { headers: { authorization: `Bearer ${share.token}` } } : {}),
      }),
    );
  }
  return createDirectoryShare(share.root);
}

/** Where this machine keeps the index for one commit of one project. */
export function suiteIndexPath(config: Pick<Config, 'project' | 'cacheRoot'>, commit: string): string {
  return join(suiteIndexRoot(config), config.project, `${commit}.bin`);
}

/**
 * Write this run's suite index, and offer it to the share.
 *
 * Both, in that order, and the local write happens even with no share
 * configured: the index is what a later question about *this* commit is
 * answered from, and a machine that derived it and threw it away will derive it
 * again on the next command.
 *
 * A report with no commit publishes nothing. There is nothing wrong with such a
 * run — a developer's laptop mid-edit has no commit that describes what it just
 * observed — but an evaluation whose address is a guess is worse than no
 * evaluation, because the next machine would believe it.
 */
export async function publishSuiteIndex(
  config: Config,
  report: RunReport,
): Promise<{ readonly commit: string; readonly shared: boolean } | undefined> {
  const index = suiteIndexOf(report);
  if (index?.commit === undefined) return undefined;

  try {
    await writeSuiteIndex(suiteIndexPath(config, index.commit), index);
  } catch {
    // A cache this machine could not write is a cache this machine does without.
  }

  const share = shareFor(config);
  if (share === undefined) return { commit: index.commit, shared: false };

  // Encoded again rather than read back from what was just written, so a
  // publish does not depend on this machine's own cache write having succeeded.
  await share.put(keyOf(config.project, index.commit), encodeSuiteIndex(index));
  return { commit: index.commit, shared: true };
}

/**
 * The line a run prints about its own index, empty when there is nothing to say.
 *
 * Here rather than in the dispatcher because the decision it encodes is this
 * module's: a run that published says where the bytes are, a run whose report
 * names no commit says nothing at all, and neither of those is a fact about how
 * the command line is wired.
 */
export async function publishedLine(config: Config, report: RunReport): Promise<string> {
  const published = await publishSuiteIndex(config, report);
  if (published === undefined) return '';
  const where = suiteIndexPath(config, published.commit);
  return `suite index: ${where}${published.shared ? ' (published)' : ''}\n`;
}

/** What a mainline lookup found, and how current it is. */
export interface MainlineIndex {
  readonly commit: string;
  /** Commits between the newest candidate and the one that answered. */
  readonly behind: number;
  /** Where it came from, for a command that has to say so. */
  readonly from: 'local' | 'share';
  readonly index: SuiteIndex;
}

/**
 * The newest mainline evaluation this checkout descends from.
 *
 * Local first, because a commit's index is the same bytes wherever it is read
 * and a disk that already holds it should not be made to ask a network. Then
 * the share, walking the same lineage.
 *
 * Returns nothing rather than throwing on every failure it can have: no share,
 * no `git`, no such ref, nothing published in the last fifty commits, bytes
 * that are not a suite index. A caller with no mainline evaluation does what it
 * has always done, which is to derive its own.
 */
export async function mainlineIndex(
  config: Config,
  options: { readonly ref?: string; readonly cwd?: string } = {},
): Promise<MainlineIndex | null> {
  const share = config.share;
  const ref = options.ref ?? share?.mainline ?? DEFAULT_MAINLINE;
  const depth = share?.depth ?? DEFAULT_DEPTH;
  const lineage = await lineageOf(ref, depth, options.cwd ?? process.cwd());
  if (lineage.length === 0) return null;

  for (let behind = 0; behind < lineage.length; behind += 1) {
    const commit = lineage[behind]!;
    const held = await readLocal(config, commit);
    if (held !== null) return { commit, behind, from: 'local', index: held };
  }

  const cache = shareFor(config);
  if (cache === undefined) return null;

  const hit = await firstShared(cache, lineage, (commit) => keyOf(config.project, commit));
  if (hit === null) return null;

  let index: SuiteIndex;
  try {
    index = decodeSuiteIndex(hit.bytes);
  } catch {
    // Bytes under the right key that are not the right format. A share is
    // shared, so this is a writer of a version this reader does not have, and
    // the answer to that is the answer to a miss.
    return null;
  }

  try {
    // Kept, so the next command on this machine does not ask again. Under the
    // commit it was published at, which is the commit it describes.
    await writeSuiteIndex(suiteIndexPath(config, hit.commit), index);
  } catch {
    // A read-only cache directory costs one fetch per command and nothing else.
  }

  return { commit: hit.commit, behind: hit.behind, from: 'share', index };
}

/**
 * The commits this checkout descends from, along `ref`, newest first.
 *
 * From the merge base rather than from `HEAD`, because that is the question: a
 * branch's evaluation of mainline is mainline's evaluation at the point the
 * branch left, and the commits on the branch itself were never published by
 * anybody. When there is no merge base — a shallow CI clone, a ref that was
 * never fetched — the ref's own history is walked instead, which is right
 * whenever the checkout *is* mainline and harmless otherwise, since a commit
 * this tree does not descend from simply has nothing published against it that
 * a lookup would find useful.
 */
export async function lineageOf(ref: string, depth: number, cwd: string): Promise<string[]> {
  const from = (await git(['merge-base', ref, 'HEAD'], cwd))?.trim();
  const start = from !== undefined && from !== '' ? from : ref;
  const listed = await git(['rev-list', '--first-parent', `-n${String(depth)}`, start], cwd);
  if (listed === undefined) return [];
  return listed.split('\n').filter((line) => line !== '');
}

async function git(args: readonly string[], cwd: string): Promise<string | undefined> {
  try {
    const { stdout } = await run('git', [...args], { cwd });
    return stdout;
  } catch {
    // No git, no repository, no such ref, a shallow clone that cannot reach
    // back. All of them mean the same thing here: no lineage to ask about.
    return undefined;
  }
}

async function readLocal(config: Pick<Config, 'project' | 'cacheRoot'>, commit: string): Promise<SuiteIndex | null> {
  try {
    return await readSuiteIndex(suiteIndexPath(config, commit));
  } catch {
    return null;
  }
}

function keyOf(project: string, commit: string): string {
  return shareKey({ project, artifact: SUITE_INDEX, commit });
}

/**
 * `variance share` — what the share holds, or what this run gave it.
 *
 * One command with two directions rather than two commands, because an operator
 * setting this up is asking one question — *is the sharing working* — and the
 * two halves of the answer are "the last run published at this commit" and "a
 * lookup from here finds that commit". Printed as prose rather than a table:
 * there are at most four facts, and three of them are absences.
 *
 * Always a clean exit for the caller. Nothing here is a verdict: a share that
 * holds nothing is a share the next run fills, and failing a pipeline over it
 * would make an optimisation load-bearing.
 */
export async function shareLines(
  config: Config,
  options: { readonly publish: boolean; readonly ref?: string; readonly report?: string },
): Promise<readonly string[]> {
  const where = describeShare(config);

  if (options.publish) {
    const report = await readCliRunReport(options.report ?? config.report);
    const published = await publishSuiteIndex(config, report);
    if (published === undefined) {
      return [
        'nothing published: this report names no commit.',
        'A run records one from `--commit` or the CI environment; an evaluation addressed',
        'by a guess would be believed by the next machine.',
      ];
    }
    return [
      `suite index at ${published.commit}: ${suiteIndexPath(config, published.commit)}`,
      published.shared ? `offered to ${where}` : 'kept locally; no `share` is configured',
    ];
  }

  const found = await mainlineIndex(
    config,
    options.ref === undefined ? {} : { ref: options.ref },
  );
  if (found === null) {
    return [
      config.share === undefined
        ? 'no share is configured; this run derives its own mainline evaluation.'
        : `no mainline evaluation found in ${where}; this run derives its own.`,
    ];
  }

  const lexicon = found.index.lexicon;
  return [
    `mainline evaluation at ${found.commit}, ${describeBehind(found.behind)}, from the ${found.from}.`,
    `${found.index.subjects.length} subject(s), ${found.index.components.length} component(s)` +
      (lexicon === undefined
        ? ', no lexicon'
        : `, lexicon over ${lexicon.fields.length} field(s) of ${lexicon.subjects.length} subject(s)`),
    `at ${suiteIndexPath(config, found.commit)}`,
  ];
}

function describeShare(config: Config): string {
  const share = config.share;
  if (share === undefined) return 'no share (none is configured)';
  return share.kind === 'directory' ? `the directory ${share.root}` : `the endpoint ${share.endpoint}`;
}

/**
 * How current a hit is, in words.
 *
 * The number is the one signal an operator has that publishing has stopped: a
 * share answering from forty commits back is a share nothing has written to
 * since, and it is otherwise indistinguishable from a healthy one.
 */
function describeBehind(behind: number): string {
  if (behind === 0) return 'the newest commit this tree descends from';
  return `${String(behind)} commit(s) behind the newest this tree descends from`;
}
