/**
 * A walk's working tree as `variance select` reads it: the diff from the
 * record's commit, the text at that commit, and the texts landings kept. A
 * walk whose run was recorded over an uncommitted edit is asked here, because
 * the journey reader takes the commit's text as every row's frame. What is
 * owed a run is asked apart, of the record's incomplete tests.
 */

import { rm } from 'node:fs/promises';
import { relationsOfFiles } from '@variance-authority/core/relate';
import { scanRelations } from '../../scan.js';
import { layeredFiles, repositoryLayers } from '../cache-layers.js';
import { changedLines } from '../diff-lines.js';
import { keptDigests, keptTexts, narrowByExecution } from '../index.js';
import { KEPT_TEXTS } from '../kept-texts.js';
import { textAtRecording } from '../recorded-text.js';
import { ELSEWHERE_TEST, patchTo, type Walk } from './carry-contract.js';

/** Removes every text the walk's landings kept, as a cleared cache or a record laid before landings kept texts leaves it. */
export async function forgetKept(walk: Walk): Promise<void> {
  for (const directory of layeredFiles(repositoryLayers(walk.root, walk.cacheRoot), KEPT_TEXTS)) {
    await rm(directory, { recursive: true, force: true });
  }
  walk.actions.push({ action: 'forget kept texts' });
}

/**
 * What `variance select` reads for the change from HEAD to `next`, in-process:
 * the test files it runs. It mirrors the CLI's `recordAgainst` in
 * `packages/cli/src/commands/resources.ts`, which hands `narrowByExecution`
 * the texts at the recording (`textAtRecording`) and the kept texts and their
 * digests (`keptTexts`, `keptDigests`). The one difference is the cache: the
 * CLI finds it from the checkout, and the walk names its own `cacheRoot`.
 */
export async function selectedFromTree(walk: Walk, next: string): Promise<readonly string[]> {
  const diff = await patchTo(walk, next);
  const recorded = textAtRecording(walk.root, changedLines(diff).keys());
  const relations = relationsOfFiles(await scanRelations({ root: walk.root, dirs: ['.'] }));
  const { entered, incomplete } = await narrowByExecution(walk.coverageFile, diff, {
    root: walk.root,
    relations,
    sourceAt: recorded,
    keptText: keptTexts(walk.root, walk.cacheRoot),
    keptDigests: keptDigests(walk.root, walk.cacheRoot),
  });
  walk.actions.push({ action: 'select from the tree', next, entered, incomplete });
  return entered.filter((test) => test !== ELSEWHERE_TEST).sort();
}
