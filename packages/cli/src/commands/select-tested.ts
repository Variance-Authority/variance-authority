/**
 * `variance select --tested <commit>`: a merge queue's group of one, selected
 * by what the two sides of its merge reach together.
 *
 * A queue merges a pull request whose tree passed at `--tested` onto the
 * mainline at `--since`, which passed there too. A test file only one side's
 * change reaches ran on that side's tree with everything the other side
 * changed out of its reach, so it is skipped. This file reads git and the
 * record for the machine in [`select-tested-state.ts`](./select-tested-state.ts),
 * which decides; each side is read the way a patch handed in is
 * ([`select-command.ts`](./select-command.ts)), from the record's commit.
 */

import type { Relations } from '@variance-authority/core/relate';
import { gitIn, topLevel } from './since.js';
import type { SuiteReading, SuiteRequest } from './select-suite.js';
import { initial, isOpen, selectionOf, transition, type MergeAnswer, type SideAnswer, type TestedInput, type TestedState } from './select-tested-state.js';
import { relationsFor } from './source-graph.js';

/** What `--tested` adds to a selection: the two commits the merge joined. */
export interface TestedRequest {
  readonly root: string;
  readonly since: string;
  readonly tested: string;
  readonly suite?: string | undefined;
  readonly noGit?: boolean | undefined;
}

type Read = (request: SuiteRequest) => Promise<SuiteReading>;
type Git = (...args: string[]) => string;

const INSTALL = new Set(['npm-shrinkwrap.json', 'package-lock.json', 'package.json', 'pnpm-lock.yaml', 'yarn.lock']);

/**
 * `full`, the selection of the whole merge, as the machine's final state
 * answers it. `read` is `selectSuite`, handed in so this file does not import
 * the one that calls it.
 */
export async function testedSuite(asked: TestedRequest, full: SuiteReading, read: Read): Promise<SuiteReading> {
  const here = (await topLevel(asked.root)) ?? asked.root;
  const git = gitIn(here);
  let state = initial(asked.tested);
  while (isOpen(state)) state = transition(state, await observe(state, { git, here, asked, full, read }));
  return selectionOf(state, full);
}

/** The one input an open state asks for, read from git and the record. */
async function observe(
  state: Extract<TestedState, { kind: 'asked' | 'merged' | 'selecting' }>,
  ctx: { git: Git; here: string; asked: TestedRequest; full: SuiteReading; read: Read },
): Promise<TestedInput> {
  const { git, here, asked, full, read } = ctx;
  switch (state.kind) {
    case 'asked':
      return { kind: 'selected', full };
    case 'selecting':
      return { kind: 'merge', answer: mergeOf(git, asked) };
    case 'merged': {
      const { mainline, tested, fork } = state.merge;
      const record = full.reading.commit ?? mainline;
      const relations = await relationsFor(here, ['.'], [], [], asked.noGit);
      const side = (end: string) => reachOf(git, read, { ...asked, at: full.reading.at, relations }, record, fork, end);
      return { kind: 'sides', pull: await side(tested), main: await side(mainline) };
    }
  }
}

/**
 * What HEAD is against `since` and `tested`: known only when it is exactly
 * the clean merge of `tested` onto `since` and the tree holds nothing beyond it.
 */
function mergeOf(git: Git, asked: TestedRequest): MergeAnswer {
  try {
    const commit = (ref: string) => git('rev-parse', '--verify', `${ref}^{commit}`).trim();
    const [mainline, tested] = [commit(asked.since), commit(asked.tested)];
    if (tested === commit('HEAD')) return { is: 'head' };
    const parents = git('rev-parse', 'HEAD^@').split('\n').filter(Boolean);
    const apart = { is: 'apart', why: `HEAD is not ${mainline.slice(0, 12)} with one pull request merged onto it` } as const;
    if (mainline === tested || parents.length !== 2 || !parents.includes(mainline) || !parents.includes(tested)) return apart;
    // A merge HEAD resolved by hand holds lines neither side wrote.
    const clean = git('merge-tree', '--write-tree', mainline, tested).split('\n')[0];
    if (clean !== git('rev-parse', 'HEAD^{tree}').trim()) return apart;
    if (git('status', '--porcelain', '--untracked-files=no').trim() !== '') return { is: 'dirty' };
    return { is: 'known', merge: { mainline, tested, fork: git('merge-base', mainline, tested).trim() } };
  } catch {
    return { is: 'unknown', why: `git could not read the merge of ${asked.tested} onto ${asked.since}` };
  }
}

/**
 * The tests one side's change reaches, read on the record's lines. Every line
 * the side changed differs from the record's commit at the fork or at the
 * side's tip, so both diffs are read, cut to the files the side changed.
 */
async function reachOf(
  git: Git,
  read: Read,
  asked: TestedRequest & { readonly at: string; readonly relations: Relations },
  record: string,
  fork: string,
  end: string,
): Promise<SideAnswer> {
  const selection = await import('@variance-authority/sense/test-selection');
  const names = (from: string, to: string) => git('diff', '--name-only', '-z', '--no-renames', from, to).split('\0').filter(Boolean);
  const own = new Set(names(fork, end));
  const code = new Set<string>();
  const install = new Set<string>();
  for (const to of new Set([fork, end])) {
    if (to === record) continue;
    const all = names(record, to);
    const kept = all.filter((file) => own.has(file));
    const installs = kept.filter((file) => INSTALL.has(file.slice(file.lastIndexOf('/') + 1)));
    const text = selection.standDiff(git, record, to);
    for (const [files, into] of [[kept.filter((file) => !installs.includes(file)), code], [installs, install]] as const) {
      if (files.length === 0) continue;
      const keep = new Set(files);
      const change = selection.withoutFiles(text, all.filter((file) => !keep.has(file)));
      const reading = await read({
        root: asked.root,
        ...(asked.suite === undefined ? {} : { suite: asked.suite }),
        ...(asked.noGit === undefined ? {} : { noGit: asked.noGit }),
        record: asked.at,
        relations: asked.relations,
        change,
      });
      if (reading.declined !== undefined) return { whole: reading.declined };
      if (reading.reading.ground !== 'read') return { whole: 'and its record could not be read' };
      for (const test of reading.whole) if (!reading.skip.has(test)) into.add(test);
    }
  }
  return { code, install };
}
