// compass: variance-authority.reach
/**
 * `variance covering --since`: the lines a diff changed, in the record's
 * coordinates, and each changed region stated over every case that reached it.
 */

import { realpath } from 'node:fs/promises';
import { relative, resolve } from 'node:path';
import { changedLines, changeInRecord, hunksByFile, type ChangeRead, type CoveringRegion, type LineRange } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { requireCommit, unreadDiff } from './base-diff.js';
import { regionState } from './covering-frame.js';
import { diffPoint, diffSince, topLevel } from './since.js';
import type { StatedRegion } from './covering.js';

/** A changed region as `--where` lists it, stated, with the cases that stopped, over every case that reached it. */
export function stated(listed: CoveringRegion, reached: CoveringRegion): StatedRegion {
  const { stopped: _, ...region } = listed;
  const state = regionState(reached);
  return {
    ...region,
    ...(reached.stopped === undefined ? {} : { stopped: reached.stopped }),
    ...(state === undefined ? {} : { state }),
  };
}

/** What a change changed, read once for every suite asked: the commit it parted from `since` at, and its diff from there, with no lines when it changed nothing. */
export interface ListedChange extends ChangeRead {
  readonly base: string;
  /** The change in the numbers of each record commit asked: suites that stand on one commit read its diff once. */
  readonly inRecords: Map<string, Promise<ReadonlyMap<string, readonly LineRange[]>>>;
}

const readChange = (diff: string): ChangeRead => ({ lines: changedLines(diff), hunks: hunksByFile(diff) });

/**
 * The change since `since`'s merge base. A ref that does not read is one
 * refusal, before any record is read: every suite would give it the same way.
 */
export async function listedChange(since: string): Promise<ListedChange> {
  const base = (await diffPoint(since))?.base;
  const diff = base === undefined ? undefined : await diffSince(since, [], base, { unified: 0 });
  if (base === undefined || diff === undefined) {
    throw new OperatorError(
      `\`--since ${since}\` could not be read as a diff. Check the ref exists and that this is a git checkout ` +
        '(a shallow CI clone needs every commit: `fetch-depth: 0` with `filter: tree:0`); ' +
        'an empty answer here would read as `your change touches nothing`.',
      { kind: 'undiffed' },
    );
  }
  return { base, ...readChange(diff), inRecords: new Map() };
}

/**
 * Every line the change changed, in the index's coordinates. The listed change
 * is the scope and the commit the record was written at only says how to read
 * it, since a hunk read at another end lands on another region: every file
 * listed stays, however much of it that record already holds.
 */
export async function changeSince(listed: ListedChange, since: string, root: string, at: string | undefined): Promise<ReadonlyMap<string, readonly LineRange[]>> {
  const lines = at === undefined || at === listed.base ? listed.lines : await inRecordAt(listed, at, since, root);

  // `git` names files from the repository root and the index from the run's. The working directory is always
  // a real path and `--root` is spelled however the caller spelled it; through a symlink (`/var` on macOS) the
  // two never meet.
  const here = process.cwd();
  const base = await realpath(root);
  const rooted = (file: string): string => (here === base ? file : relative(base, resolve(here, file)));
  return new Map([...lines].map(([file, ranges]) => [rooted(file), ranges]));
}

/** The listed change in the numbers of `at`, read the first time that commit is asked. */
function inRecordAt(listed: ListedChange, at: string, since: string, root: string): Promise<ReadonlyMap<string, readonly LineRange[]>> {
  const read = listed.inRecords.get(at) ?? readFrom(at, since, root).then((diff) => changeInRecord(diff, listed));
  listed.inRecords.set(at, read);
  return read;
}

/** The diff from `at`. The listed change read, so what git could not read is from the record's commit. */
async function readFrom(at: string, since: string, root: string): Promise<string> {
  const diff = await diffSince(since, [], at, { unified: 0 });
  if (diff !== undefined) return diff;
  await requireCommit(at, (await topLevel(root)) ?? root, 'The record');
  throw new OperatorError(unreadDiff('The record', at), { kind: 'undiffed' });
}

/** The refusal of a change with no region in it: each suite's reason, when a question reads them all. */
export function nothingChanged(since: string): OperatorError {
  return new OperatorError(`nothing has changed since \`${since}\`, so there is no region to ask about.`);
}
