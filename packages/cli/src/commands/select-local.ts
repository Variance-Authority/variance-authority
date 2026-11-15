/**
 * `variance select --local`: the selection of a local seam, which a doubt
 * never widens.
 *
 * Each reason the record cannot narrow — no journal, no coverage, a diff from
 * the record git cannot produce, an install it cannot compare, nothing
 * recorded whole — runs every test file at the gate, where a miss breaks the
 * mainline. On a local seam (`yarn test:loop`, `yarn verify:near`, or anything
 * that asks by name) a test runs only on evidence: the selection runs the test
 * files that import a changed file, by the source index, and nothing else. A
 * changed file the graph does not hold, a lockfile among them, selects nothing
 * and is named. A change to what the suite declares in `before` still runs the
 * whole suite, because that is declared, not a doubt. When no diff can be read
 * from any base there is nothing to select by, and the command refuses. The
 * tests left are skipped and named, and a skipped file keeps its stand, so a
 * later run without `--local` runs them; the whole run on the mainline is
 * where a test only that run reaches fails (ADR-0102).
 */

import { existsSync } from 'node:fs';
import { askCoverageFile, changedLines, isTestCoverageFile } from '@variance-authority/sense/test-selection';
import { affectedBy, nodesOfKind, RUNTIME_EDGES, type Relations } from '@variance-authority/core/relate';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { isTestPath } from '@variance-authority/sense';
import { OperatorError } from '../exit.js';
import { diffSince, topLevel } from './since.js';
import { selectMainline } from './mainline-selected.js';
import { restingOf, suiteIgnore, type Resting } from './select-before.js';
import { handedChange, isHanded } from './select-journey.js';
import { indexUpToCheckout, relationsFor } from './source-graph.js';
import type { SuiteRequest } from './select-suite.js';
import type { SelectGround } from './select.js';
import { many } from './prose-counts.js';
import type { TestSelection } from './select.js';

/** The rung a selection fell to: the changed files' importers, the only one there is. */
export type LocalRung = 'importers';

/** What the ladder selected, what it left for a run without `--local`, and what it could not place. */
export interface LocalAnswer {
  readonly rung: LocalRung;
  readonly selected: readonly string[];
  readonly left: readonly string[];
  /** The changed files the source index does not hold, which select nothing. */
  readonly unheld: readonly string[];
}

/** What the ladder is asked: the changed files, from the top of the checkout, and what it already knows. */
export interface LocalQuestion {
  readonly relations: Relations;
  readonly changed: readonly string[];
  /** The test files the record holds whole, which the graph may not name as tests. */
  readonly whole: readonly string[];
}

/** The test files that import a changed file, and every other test file left. */
export function localLadder(question: LocalQuestion): LocalAnswer {
  const { relations, changed } = question;
  const { files, missing } = affectedBy(relations, changed, { through: RUNTIME_EDGES });
  const universe = [
    ...new Set([
      ...nodesOfKind(relations, 'file').map((id) => relations.names[id]!).filter(isTestPath),
      ...question.whole,
    ]),
  ].sort(codeUnitOrder);
  const reached = new Set(files);
  return {
    rung: 'importers',
    selected: universe.filter((test) => reached.has(test)),
    left: universe.filter((test) => !reached.has(test)),
    unheld: [...new Set(missing)].sort(codeUnitOrder),
  };
}

/** What the selection already read when it declined: the changed files, and the graph once it was built. */
export interface Held {
  readonly changed: readonly string[];
  readonly relations?: Relations;
}

/**
 * The ladder's answer for a reading declined on `ground`, or the changed files
 * the suite rests on, which run the whole suite. A change not yet read is the
 * patch handed in, or the diff from `--since`, else from `HEAD`'s merge base
 * with the mainline, so committed work counts, else from `HEAD`. A `--since`
 * that cannot be read is refused, never read from another base, and so is a
 * change no base gives. The test files the `record` holds count whatever their
 * names say.
 */
export async function localAnswer(
  request: SuiteRequest,
  ground: SelectGround,
  held?: Held,
  record?: string,
): Promise<LocalAnswer | Required<Pick<Resting, 'whole'>>> {
  const root = (await topLevel(request.root)) ?? request.root;
  const diff = held !== undefined ? undefined : isHanded(request) ? await handedChange(request) : await changeSince(root, request.since);
  const changed = held?.changed ?? (diff === undefined ? undefined : [...changedLines(diff).keys()]);
  if (changed === undefined) {
    throw new OperatorError(
      `${whyDeclined(ground)}, and \`--local\` could not read what changed from the mainline's merge base or from \`HEAD\` either. ` +
        'With no change there is nothing to select by, and an empty answer would look like a clean one, so it refuses. Run it in a git checkout.',
    );
  }
  let relations = held?.relations ?? request.relations;
  if (relations === undefined) {
    await indexUpToCheckout(root, undefined, !request.noGit);
    relations = await relationsFor(root, ['.'], [], [], request.noGit);
  }
  // A reading that declined before it looked at what the suite rests on has not said, so the ladder asks, as the gate does.
  const { whole } = await restingOf(root, request.suite, relations, changed, await suiteIgnore(root, request.suite));
  if (whole !== undefined) return { whole };
  return localLadder({
    relations,
    changed,
    whole: [...(ground.kind === 'read' ? ground.narrowing.whole : []), ...recordedTests(record)],
  });
}

/** What a declined ground could not read, as the refusal opens. */
function whyDeclined(ground: SelectGround): string {
  switch (ground.kind) {
    case 'no-diff':
      return `the selection cannot read what changed since ${ground.from}`;
    case 'no-journal':
      return 'there is no execution journal to narrow by';
    case 'no-coverage':
      return 'the record holds no coverage';
    case 'no-install':
      return ground.whole;
    case 'before':
    case 'read':
      return 'the record cannot narrow';
  }
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
 * left, says why the record could not answer, names the changed files that
 * select nothing, and the tests a later run takes.
 */
export function fellTo(selection: TestSelection, answer: LocalAnswer): TestSelection {
  const { widened, ...rest } = selection;
  const total = answer.selected.length + answer.left.length;
  const named = answer.left.slice(0, NAMED).join(', ');
  const more = answer.left.length > NAMED ? `, and ${answer.left.length - NAMED} more` : '';
  const unheld = answer.unheld.slice(0, NAMED).join(', ');
  const beyond = answer.unheld.length > NAMED ? `, and ${answer.unheld.length - NAMED} more` : '';
  return {
    ...rest,
    skip: answer.left,
    // No evidence, no test: a file the seam discovers that neither the index nor the record holds is not selected.
    only: answer.selected,
    fell: { rung: answer.rung, from: widened!, left: answer.left, only: answer.selected },
    because: `${widened}, so \`--local\` selected the test files that import the changed files, by the source index: ${answer.selected.length} of ${many(total, 'test file')}`,
    notes: [
      ...(answer.unheld.length === 0
        ? []
        : [
            `the source index does not hold ${many(answer.unheld.length, 'changed file')}, so ${answer.unheld.length === 1 ? 'it selects' : 'they select'} no test file; ` +
              `a file a test reads without importing it is named by a \`/// <depends>\` in the module that reads it: ${unheld}${beyond}`,
          ]),
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
