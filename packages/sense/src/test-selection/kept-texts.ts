/**
 * The text a run recorded over, kept when its commit does not hold it.
 *
 * A recording's line ranges are coordinates in the text the suite ran over, and
 * the recorder writes only a digest of that text beside the rows. When the tree
 * was clean the commit on the label holds the text, and the reader finds it
 * there. A suite is recorded by being run, though, and in a developer's loop or
 * an agent's the tree is dirty when it runs: edit, `yarn test`, then commit or
 * revert. The commit does not hold that text, and without it every region of
 * the module was charged, every time, until somebody recorded over a clean tree.
 *
 * The landing had the text in hand. So it keeps it: for each recorded module
 * git says is dirty, the text on disk is written to the layer's `.texts/`,
 * named by its digest — the value `modules.source` already holds. A reader asks
 * by that digest, and a text found is checked against it again, so a store
 * that was tampered with or cut short answers nothing rather than something
 * wrong.
 *
 * Content-addressed, so where a text is written does not decide what it means:
 * a worktree reads its own layer and then the primary checkout's, and a text
 * the primary kept serves the record a worktree was seeded from.
 *
 * `.texts` is dotted for the reason `.work` is: a layer's other directories are
 * record-store labels, which are caller-chosen and cannot begin with a dot.
 */

// compass: variance-authority.reach

import { readFileSync } from 'node:fs';
import { access, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { digestString } from '../digest.js';
import { workingTreeChanges } from '../working-tree-changes.js';
import { layeredFiles, repositoryLayers } from './cache-layers.js';
import type { TestCoverageView } from './format-view.js';
import { findModules } from './lookup.js';
import { writeCoverageBytes } from './record-location.js';
import { repositoryRoot } from './repository-root.js';

/** The directory inside a layer the kept texts are written to. */
// TODO: nothing prunes `.texts`; a text no recording's row names any more is
// dead weight, and removing it needs prune to ask every record in the layer.
export const KEPT_TEXTS = '.texts';

/** Where one digest's text sits inside a layer. */
function keptName(digest: string): string {
  return `${KEPT_TEXTS}/${digest.replace(/^[^:]+:/u, '')}`;
}

/**
 * Keep the text of every module `record` holds that git says differs from
 * `HEAD`, when the text on disk is the one the record's row was cut from.
 *
 * Git answers which files are dirty; nothing here hashes the checkout. A dirty
 * file whose text on disk has moved again since the run — an edit made while
 * the suite ran — hashes to no row's digest and is not kept, so the reader
 * charges it whole, as before, rather than reading a text the tests never ran.
 *
 * Returns the digests it kept. Never throws: a text that could not be kept is
 * a module charged whole later, which is the answer that was given before any
 * text was kept.
 */
export async function keepRecordedTexts(
  root: string,
  record: TestCoverageView,
  cacheRoot?: string,
): Promise<readonly string[]> {
  if (record.commit === undefined) return [];
  let repository: string;
  let top: string;
  try {
    repository = repositoryRoot(root);
    ({ top } = repositoryLayers(repository, cacheRoot));
  } catch {
    return [];
  }
  // Asked as the scan asks it, so a checkout's untracked cache answers it.
  const changes = await workingTreeChanges(repository, true);
  if (changes === undefined) return [];
  const kept: string[] = [];
  for (const file of changes.changed) {
    const rows = findModules(record, file).filter((module) => record.moduleInstrumented.at(module) === 1);
    if (rows.length === 0) continue;
    const digests = new Set(rows.map((module) => record.string(record.moduleSource.at(module))));
    let text: string;
    try {
      text = await readFile(resolve(repository, file), 'utf8');
    } catch {
      continue;
    }
    const digest = digestString(text);
    if (!digests.has(digest)) continue;
    const at = resolve(top, keptName(digest));
    try {
      // The name is the content, so a text already there is this text.
      await access(at);
    } catch {
      try {
        await writeCoverageBytes(at, Buffer.from(text, 'utf8'));
      } catch {
        continue;
      }
    }
    kept.push(digest);
  }
  return kept;
}

/**
 * A reader of kept texts for `root`: this checkout's layer first, then the
 * primary checkout's. `undefined` when no layer kept the digest, or the file
 * found does not hash to it.
 */
export function keptTexts(root: string, cacheRoot?: string): (digest: string) => string | undefined {
  let layers: ReturnType<typeof repositoryLayers> | undefined;
  return (digest) => {
    try {
      layers ??= repositoryLayers(root, cacheRoot);
    } catch {
      return undefined;
    }
    for (const file of layeredFiles(layers, keptName(digest))) {
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch {
        continue;
      }
      if (digestString(text) === digest) return text;
    }
    return undefined;
  };
}
