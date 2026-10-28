/**
 * The case a worker is running, for a party in the worker that has something
 * to hand it.
 *
 * Eyes closes one journal per test and has no way to name the test that the
 * record would join: the runner's `testId` is not the case id, and a title is
 * not unique. So it names none. It hands the journal to whatever case is
 * running, and the recorder — which already names that case for its crossings —
 * keeps it there, under the attempt the runner counts.
 *
 * The scope sits where Sense's own runner seams put theirs, under one realm
 * symbol, so a producer asks one place whichever runner it runs in. It is there
 * only while a recording run is inside a test: outside one, or in a run that
 * does not record, a producer finds nothing and keeps its journal to itself.
 */

import type { TestInfo } from '@playwright/test';
import type { ExecutionRecorder } from './execution.js';
import { testOf } from './test-coordinate.js';

/** Mirrors `CASE_SCOPE` in `@variance-authority/sense`'s `cases.ts`. */
const CASE_SCOPE = Symbol.for('variance-authority.test-selection.cases');

/** What a producer finds in the realm while a recorded test runs. */
interface CaseScope {
  /** The checkout the record names files against, so a journal's paths can be spelled the same way. */
  readonly root: string;
  /** Keep a journal for the running case, under this attempt. */
  readonly eyes: (journal: Readonly<Record<string, unknown>>) => boolean;
  /** Say the running case opened a journal, so a case that hands none over is told apart from one that opened none. */
  readonly watch: () => void;
}

type Holder = { [CASE_SCOPE]?: unknown };

/**
 * Open the scope for one test, and return what closes it.
 *
 * The attempt is `retry + 1`: the record counts from 1 and a first run is not
 * a retry. A scope something else installed is left as it was found.
 */
export function enterCase(recorder: ExecutionRecorder, testInfo: TestInfo): () => void {
  const holder = globalThis as Holder;
  const owner = recorder.owner(testInfo);
  const subject = testOf(testInfo);
  const attempt = testInfo.retry + 1;
  const scope: CaseScope = {
    root: recorder.root,
    eyes: (journal) => {
      recorder.eyes(owner, subject, attempt, journal);
      return true;
    },
    watch: () => recorder.eyes(owner, subject, attempt),
  };
  const before = holder[CASE_SCOPE];
  holder[CASE_SCOPE] = scope;
  return () => {
    if (holder[CASE_SCOPE] !== scope) return;
    if (before === undefined) delete holder[CASE_SCOPE];
    else holder[CASE_SCOPE] = before;
  };
}
