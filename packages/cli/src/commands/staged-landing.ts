import { randomUUID } from 'node:crypto';
import { rename, rm } from 'node:fs/promises';
import { commitRunsFile, withIndexLock } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { said } from '../here.js';

interface Staged<T> {
  readonly kept: boolean;
  readonly runs: boolean;
  /** An artifact replacement discards obsolete sidecar metadata when its inputs name none. */
  readonly replaceRuns?: true;
  readonly value: T;
}

/** Prepare a record and its runs beside their targets under the record lock, then publish both. */
export async function stagedLanding<T>(at: string, prepare: (record: string, runs: string) => Promise<Staged<T>>): Promise<T> {
  const runsAt = commitRunsFile(at);
  const stage = `${process.pid}-${randomUUID()}.tmp`;
  const staged = `${at}.${stage}`;
  const stagedRuns = `${runsAt}.${stage}`;
  const locked = await withIndexLock(at, async () => {
    try {
      const ready = await prepare(staged, stagedRuns);
      if (ready.kept) await rename(staged, at);
      // FIXME: the snapshot and runs record are two files and are not renamed
      // together. A retry repairs an interrupted landing through commitRunsAfter;
      // the snapshot goes first so the record never claims coverage not yet kept.
      if (ready.runs) await rename(stagedRuns, runsAt);
      else if (ready.replaceRuns) await rm(runsAt, { force: true });
      return ready.value;
    } finally {
      await rm(staged, { force: true });
      await rm(stagedRuns, { force: true });
    }
  });
  if (!locked.held) throw new OperatorError(
    `nothing landed at ${said(at)}: another process is holding ${said(`${at}.lock`)}. ` +
    'Land again once that run ends.',
  );
  return locked.value;
}
