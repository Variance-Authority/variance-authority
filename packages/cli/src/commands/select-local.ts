/**
 * `variance select --local`: what a selection that cannot narrow falls to.
 *
 * Each reason the record cannot narrow — no journal, no coverage, no diff, an
 * install it cannot compare, a change to what the suite rests on, nothing
 * recorded whole — runs every test file. That is the answer for a gate, and a
 * wait in an edit loop. Asked for by name, never detected, the selection falls
 * down a ladder instead: past the record, which a share's mainline already
 * answers for, to the changed files' importers in the source index, and to the
 * changed files' packages. A file the graph does not hold, or one the suite
 * rests on, is answered by its package; one the root owns, such as a lockfile,
 * by the packages whose manifest changed. The tests left are skipped and named,
 * and a skipped file keeps its stand, so a later run without `--local` runs them.
 */

import { relative } from 'node:path';
import { changedLines } from '@variance-authority/sense/test-selection';
import { affectedBy, nodesOfKind, RUNTIME_EDGES, within, type Relations } from '@variance-authority/core/relate';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { isTestPath } from '@variance-authority/sense';
import { packageOf } from '../package-home.js';
import { diffSince, topLevel } from './since.js';
import { handedChange, isHanded } from './select-journey.js';
import { indexUpToCheckout, relationsFor } from './source-graph.js';
import type { SuiteRequest } from './select-suite.js';
import type { SelectGround } from './select.js';
import { many } from './prose-counts.js';
import type { TestSelection } from './select.js';

/** The rung a selection fell to: the changed files' importers, or their packages. */
export type LocalRung = 'importers' | 'package';

/** What the ladder selected, and what it left for a run without `--local`. */
export interface LocalAnswer {
  readonly rung: LocalRung;
  readonly selected: readonly string[];
  readonly left: readonly string[];
}

/** What the ladder is asked: the changed files, from the top of the checkout, and what it already knows. */
export interface LocalQuestion {
  readonly root: string;
  readonly relations: Relations;
  readonly changed: readonly string[];
  /** The changed files the suite rests on: no importer walk says what they reach. */
  readonly rests: readonly string[];
  /** The test files the record holds whole, which the graph may not name as tests. */
  readonly whole: readonly string[];
}

/** The tests the changed files reach, by the coarsest rung any of them needed. */
export function localLadder(question: LocalQuestion): LocalAnswer {
  const { root, relations, changed } = question;
  const resting = new Set(question.rests);
  const own = (file: string): string | undefined => {
    const home = packageOf(root, file);
    const named = home === undefined ? '' : relative(root, home);
    return named === '' ? undefined : named;
  };
  const walked = changed.filter((file) => !resting.has(file));
  const { files, missing } = affectedBy(relations, walked, { through: RUNTIME_EDGES });
  const fallen = [...question.rests, ...missing];
  const manifests = changed.flatMap((file) => (file.endsWith('/package.json') ? [own(file)] : []));
  // A file the root owns is answered by the packages whose manifest moved with it, and by every test when none did.
  const homes = fallen.flatMap((file) => {
    const home = own(file);
    return home !== undefined ? [home] : manifests.length > 0 ? manifests.flatMap((one) => (one === undefined ? [] : [one])) : ['.'];
  });
  const universe = [
    ...new Set([
      ...nodesOfKind(relations, 'file').map((id) => relations.names[id]!).filter(isTestPath),
      ...question.whole,
    ]),
  ].sort(codeUnitOrder);
  const reached = new Set(files);
  const everything = homes.includes('.');
  const selected = universe.filter((test) => everything || reached.has(test) || within(test, homes));
  const chosen = new Set(selected);
  return {
    rung: fallen.length === 0 ? 'importers' : 'package',
    selected,
    left: universe.filter((test) => !chosen.has(test)),
  };
}

/** What the selection already read when it declined: the changed files, and the graph once it was built. */
export interface Held {
  readonly changed: readonly string[];
  readonly relations?: Relations;
}

/**
 * The ladder's answer for a reading declined on `ground`. A change not yet read
 * is the patch handed in, or the diff from `--since`, else from HEAD; one that
 * cannot be read at all is no change, so every test is left.
 */
export async function localAnswer(request: SuiteRequest, ground: SelectGround, held?: Held): Promise<LocalAnswer> {
  const root = (await topLevel(request.root)) ?? request.root;
  const diff = held !== undefined ? undefined : isHanded(request)
    ? await handedChange(request)
    : (await diffSince(request.since ?? 'HEAD', [], undefined, { cwd: root })) ?? (await diffSince('HEAD', [], undefined, { cwd: root }));
  const changed = held?.changed ?? (diff === undefined ? [] : [...changedLines(diff).keys()]);
  let relations = held?.relations ?? request.relations;
  if (relations === undefined) {
    await indexUpToCheckout(root, undefined, !request.noGit);
    relations = await relationsFor(root, ['.'], [], [], request.noGit);
  }
  return localLadder({
    root,
    relations,
    changed,
    rests: ground.kind === 'before' ? ground.rests : [],
    whole: ground.kind === 'read' ? ground.narrowing.whole : [],
  });
}

/** How many named tests a note lists before it counts the rest. */
const NAMED = 5;

/**
 * A widened reading, fallen to the ladder's answer: it skips what the rung
 * left, says which rung and why, and names the tests a later run takes.
 */
export function fellTo(selection: TestSelection, answer: LocalAnswer): TestSelection {
  const { widened, ...rest } = selection;
  const total = answer.selected.length + answer.left.length;
  const by = answer.rung === 'importers' ? 'that import the changed files, by the source index' : "in the changed files' packages";
  const named = answer.left.slice(0, NAMED).join(', ');
  const more = answer.left.length > NAMED ? `, and ${answer.left.length - NAMED} more` : '';
  return {
    ...rest,
    skip: answer.left,
    fell: { rung: answer.rung, from: widened!, left: answer.left },
    because: `${widened}, so \`--local\` selected the test files ${by}: ${answer.selected.length} of ${many(total, 'test file')}`,
    notes: [
      ...(answer.left.length === 0
        ? []
        : [
            `${many(answer.left.length, 'test file')} ${answer.left.length === 1 ? 'is' : 'are'} left for a run without \`--local\`, ` +
              `and ${answer.left.length === 1 ? 'keeps its' : 'each keeps its'} stand: ${named}${more}`,
          ]),
      ...selection.notes,
    ],
  };
}
