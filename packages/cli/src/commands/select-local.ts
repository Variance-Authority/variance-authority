/**
 * `variance select --local`: what a selection that cannot narrow falls to.
 *
 * Each reason the record cannot narrow — no journal, no coverage, no diff, an
 * install it cannot compare, a change to what the suite rests on, nothing
 * recorded whole — runs every test file. That is the answer for a gate, and a
 * wait in an edit loop. Asked for by name, never detected, the selection falls
 * down a ladder instead: past the record, which a share's mainline already
 * answers for, to the changed files' importers in the source index, and to the
 * changed files' packages. Every changed file is walked to its importers. A
 * file the graph does not hold, or one the suite rests on, also selects its
 * package, and the root is a package: a lockfile selects the packages whose
 * manifest changed beside it, and every test file when none did, as does any
 * other file the root owns. The tests left are skipped and named, and a skipped
 * file keeps its stand, so a later run without `--local` runs them.
 */

import { existsSync } from 'node:fs';
import { basename, relative, sep } from 'node:path';
import { askCoverageFile, changedLines, isTestCoverageFile } from '@variance-authority/sense/test-selection';
import { affectedBy, nodesOfKind, RUNTIME_EDGES, within, type Relations } from '@variance-authority/core/relate';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { isTestPath } from '@variance-authority/sense';
import { LOCKFILES } from '@variance-authority/sense/lock';
import { packageOf } from '../package-home.js';
import { OperatorError } from '../exit.js';
import { diffSince, topLevel } from './since.js';
import { selectMainline } from './mainline-selected.js';
import { restsOf } from './select-before.js';
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
  /** Absent when what changed could not be read from any base: every test file is selected. */
  readonly changed: readonly string[] | undefined;
  /** The changed files the suite rests on: no importer walk says what they reach. */
  readonly rests: readonly string[];
  /** The test files the record holds whole, which the graph may not name as tests. */
  readonly whole: readonly string[];
}

/** The tests the changed files reach, by the coarsest rung any of them needed. */
export function localLadder(question: LocalQuestion): LocalAnswer {
  const { root, relations } = question;
  const changed = question.changed ?? [];
  // The root is a package, named `.`, which `within` reads as every file.
  const own = (file: string): string => {
    const home = packageOf(root, file);
    return home === undefined ? '.' : relative(root, home).split(sep).join('/') || '.';
  };
  const { files, missing } = affectedBy(relations, changed, { through: RUNTIME_EDGES });
  // A change that could not be read is the root's: every test file.
  const fallen = [...new Set([...question.rests, ...missing, ...(question.changed === undefined ? ['.'] : [])])];
  const manifests = changed.filter((file) => file.endsWith('/package.json')).map(own);
  const lockfile = (file: string): boolean => (LOCKFILES as readonly string[]).includes(basename(file));
  // A lockfile the root owns moves the packages whose manifest moved with it, or every one when none did.
  const homes = fallen.flatMap((file) => {
    const home = own(file);
    return home === '.' && lockfile(file) && manifests.length > 0 ? manifests : [home];
  });
  const universe = [
    ...new Set([
      ...nodesOfKind(relations, 'file').map((id) => relations.names[id]!).filter(isTestPath),
      ...question.whole,
    ]),
  ].sort(codeUnitOrder);
  const reached = new Set(files);
  const selected = universe.filter((test) => reached.has(test) || within(test, homes));
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
 * is the patch handed in, or the diff from `--since`, else from `HEAD`'s merge
 * base with the mainline, so committed work counts, else from `HEAD`. A
 * `--since` that cannot be read is refused, never read from another base. The
 * test files the `record` holds count whatever their names say.
 */
export async function localAnswer(request: SuiteRequest, ground: SelectGround, held?: Held, record?: string): Promise<LocalAnswer> {
  const root = (await topLevel(request.root)) ?? request.root;
  const diff = held !== undefined ? undefined : isHanded(request) ? await handedChange(request) : await changeSince(root, request.since);
  const changed = held?.changed ?? (diff === undefined ? undefined : [...changedLines(diff).keys()]);
  let relations = held?.relations ?? request.relations;
  if (relations === undefined) {
    await indexUpToCheckout(root, undefined, !request.noGit);
    relations = await relationsFor(root, ['.'], [], [], request.noGit);
  }
  // A reading that declined before it looked at what the suite rests on has not said, so the ladder asks.
  const rests = ground.kind === 'before' ? ground.rests : (await restsOf(root, request.suite, relations, changed ?? [])).rests;
  return localLadder({
    root,
    relations,
    changed,
    rests,
    whole: [...(ground.kind === 'read' ? ground.narrowing.whole : []), ...recordedTests(record)],
  });
}

/** The diff from `since`, or, unasked, from the mainline fork, else `HEAD`; a `since` it cannot read is refused. */
async function changeSince(root: string, since: string | undefined): Promise<string | undefined> {
  if (since === undefined) {
    return (await diffSince((await mainlineFork(root)) ?? 'HEAD', [], undefined, { cwd: root })) ?? (await diffSince('HEAD', [], undefined, { cwd: root }));
  }
  const diff = await diffSince(since, [], undefined, { cwd: root });
  if (diff === undefined) {
    throw new OperatorError(
      `\`--local --since ${since}\` could not read what changed. Reading it from another base would select for a change you did not ask about, so it refuses instead. Check the ref exists.`,
    );
  }
  return diff;
}

/** The test files `record` holds, or none when it is no record or holds no coverage. */
function recordedTests(record: string | undefined): readonly string[] {
  if (record === undefined || !existsSync(record) || !isTestCoverageFile(record)) return [];
  try {
    return askCoverageFile(record, (view) => Array.from(view.testPath.all(), (path) => view.string(path)));
  } catch {
    return [];
  }
}

/** `HEAD`'s merge base with the mainline selected for this checkout, when one is. */
async function mainlineFork(root: string): Promise<string | undefined> {
  const chosen = await selectMainline(root);
  return 'unconfigured' in chosen ? undefined : chosen.named?.base;
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
