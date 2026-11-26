// compass: variance-authority.reach.crossings
/**
 * `variance view`: the recording as one page to explore.
 *
 * It reads the record and writes a file; nothing runs. Opening the page is the
 * person's: the command prints where it is.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { cacheRootFor, declaredSuites, nearestRecord, rawRecord } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { keptInOrder, lineCellOf, READ_REUSE_MS } from '../share-lines.js';
import { VIEW_SINCE_DEFAULT, type ParsedView } from '../view-args.js';
import { selectMainline } from './mainline-selected.js';
import { describeMiss } from './share.js';
import { historyOf } from './view-history.js';
import type { History } from './view-history-tables.js';
import { viewPage } from './view-page.js';

/** What the command is told while it works, and when it is. */
export interface ViewHere {
  /** A line for the person waiting, written as it happens. */
  readonly progress?: (line: string) => void;
  readonly now?: number;
}

/** The page's path on stdout. */
export async function viewOutput(parsed: ParsedView, cwd: string, here: ViewHere = {}): Promise<{ readonly out: string; readonly err: string }> {
  const { suite, recording } = chosen(cwd, parsed.suite);
  const record = readFileSync(recording);
  const history = await historyFor(cwd, parsed.since ?? VIEW_SINCE_DEFAULT, here);
  const path = resolve(cwd, `${cacheRootFor(cwd)}/variance-view.html`);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, viewPage({ ...(suite === undefined ? {} : { suite }), recording, size: record.length, packed: gzipSync(rawRecord(record)), history, code: code() }));
  return { out: `${path}\n`, err: '' };
}

const NO_SHARE: History = { unread: 'no share is configured, so no mainline record is kept' };

/** The series of the mainline this checkout reads, from the share the root config names, or why there is none. */
async function historyFor(cwd: string, since: number, here: ViewHere): Promise<History> {
  const selected = await selectMainline(cwd);
  if ('unconfigured' in selected) return { unread: `the share section does not parse: ${selected.unconfigured}` };
  if (selected.share === undefined) return NO_SHARE;
  // A configured share is a cell or the miss that says why not; `lineCellOf` answers nothing only where none is.
  const cell = (await lineCellOf({ share: selected.share, cacheRoot: selected.cacheRoot }, { cwd, reuseMs: READ_REUSE_MS }))!;
  if ('kind' in cell) return { unread: `the share could not be opened: ${describeMiss(cell)}` };
  if (selected.named === undefined) return { unread: 'no mainline could be chosen for this checkout' };
  const mainline = selected.named.name;
  const share = selected.share;
  return historyOf(cell, mainline, {
    since,
    now: here.now ?? Date.now(),
    cacheDir: selected.cacheRoot,
    order: (kept, opens) => keptInOrder({ share }, mainline, kept, opens, cwd),
    ...(here.progress === undefined ? {} : { progress: here.progress }),
  });
}

/** The suite asked for, or the first whose record is on disk; each is located, none is read. */
function chosen(root: string, suite: string | undefined): { readonly suite?: string; readonly recording: string } {
  const declared = declaredSuites(root)?.map((held) => held.name);
  if (suite !== undefined && declared !== undefined && !declared.includes(suite)) {
    throw new OperatorError(`view: no suite is declared as ${suite}; the config declares ${declared.join(', ')}`);
  }
  const located = (suite === undefined ? (declared ?? [undefined]) : [suite]).map((name) => ({
    ...(name === undefined ? {} : { suite: name }),
    recording: nearestRecord(root, name === undefined ? {} : { suite: name }).file,
  }));
  const found = located.find((held) => existsSync(held.recording));
  if (found === undefined) throw new OperatorError(`view: nothing is recorded at ${located.map((held) => held.recording).join(', ')}`);
  return found;
}

/** The page's code, bundled by the package's build. */
function code(): string {
  const at = [new URL('./view.bundle.js', import.meta.url), new URL('../../dist/commands/view.bundle.js', import.meta.url)]
    .map((url) => fileURLToPath(url))
    .find((file) => existsSync(file));
  if (at === undefined) throw new Error('view: view.bundle.js is missing from the built package');
  return readFileSync(at, 'utf8');
}
