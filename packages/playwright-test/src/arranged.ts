/**
 * The case a snapshot was taken in, and what that case had arranged when it was.
 *
 * A snapshot answers what the page looked like. A reviewer deciding whether a
 * change is intended also needs the conditions it was taken under: the network
 * mocked or live, the flag on or off. A case states those with
 * `variancePrecondition`, and the coverage record keeps them on the case's row
 * as they stood when the case ended. A snapshot is taken part-way through, so
 * it carries its own view: what the case had said by then.
 *
 * The case is named as the record names it, by its file, its declaration path
 * and Playwright's test id, so a snapshot and the case's row join on the key
 * the record already carries rather than on a second identity.
 */

import type { TestInfo } from '@playwright/test';
import { preconditionText, type CasePrecondition } from '@variance-authority/sense/journal';
import { repositoryRoot } from '@variance-authority/sense/test-selection';
import type { ExecutionRecorder } from './execution.js';
import { ownerOf, testOf } from './test-coordinate.js';

/** The case a snapshot was taken in, as the coverage record names it. */
export interface SnapshotCase {
  /** The test file, repository-relative. */
  readonly file: string;
  /** The declaration path inside it, as a person reads it. */
  readonly name: string;
  /** Playwright's test id, stable across retries. */
  readonly id: string;
  /** The project that ran it; absent for an unnamed one. */
  readonly project?: string;
  /**
   * What the case had said when the snapshot was taken, resolved as its row
   * resolves it. Absent when the run did not listen, which is not the same as
   * a case that said nothing: that one is empty.
   */
  readonly preconditions?: readonly CasePrecondition[];
}

/**
 * The case running in `testInfo`, with what it has said so far when
 * `recorder` is listening for it.
 *
 * Without a recorder the file is named from the checkout `process.cwd()` is
 * in, which is where a recorder with no `root` names it from.
 */
export function snapshotCaseOf(testInfo: TestInfo, recorder: ExecutionRecorder | undefined): SnapshotCase {
  const file = recorder?.owner(testInfo) ?? ownerOf(repositoryRoot(process.cwd()), testInfo);
  const test = testOf(testInfo);
  const preconditions = recorder?.arranged(file, test);
  return { file, ...test, ...(preconditions === undefined ? {} : { preconditions }) };
}

/** The case and its arrangement in one line, for a message and an annotation alike. */
export function arrangedText(taken: SnapshotCase): string {
  const where = `taken in ${taken.file} > ${taken.name}`;
  const said = taken.preconditions;
  if (said === undefined) {
    return `${where}, preconditions unmeasured: varianceExecution is off, so no variancePrecondition call was recorded`;
  }
  if (said.length === 0) return `${where}, no preconditions recorded`;
  return `${where}, ran under ${preconditionText(said)}`;
}
