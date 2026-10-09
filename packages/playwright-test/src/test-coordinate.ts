/**
 * How a Playwright test is named in the recording: the file that owns its
 * crossings, and the declaration path and id of the case inside it.
 *
 * Every half of the seam — the recorder, the fixtures that mark and join, the
 * vantage — spells a test the same way or it is two tests, so the spelling has
 * one home.
 */

import type { TestInfo } from '@playwright/test';
import { relative, resolve, sep } from 'node:path';

/** Which test a window belongs to, where the run is recording that. */
export interface ObservedTest {
  /** The declaration path inside the spec file, as a person reads it. */
  readonly name: string;
  /** Stable across retries, so a flake and its retry are one case read twice. */
  readonly id: string;
}

/**
 * Where a test is declared, as the execution index names it.
 *
 * Playwright's own `titlePath` opens with the project and the file, which the
 * index already holds as the owner; what is left is the path a person reads in
 * the report, and the one a `describe` in a diff moves.
 */
export function testOf(testInfo: TestInfo): ObservedTest {
  const path = [...testInfo.titlePath];
  // FIXME: the project is dropped here and not carried beside the case, so a spec
  // two projects both run is recorded as `file > name` and `file > name#1`, where
  // the Vitest seam spells each copy `|project| file > name` (`caseIds` in sense).
  if (path[0] === testInfo.project.name) path.shift();
  if (path[0] !== undefined && testInfo.file.endsWith(path[0])) path.shift();
  return { name: path.join(' > '), id: testInfo.testId };
}

/** The test file a subject's crossings belong to, repository-relative. */
export function ownerOf(root: string, testInfo: TestInfo): string {
  return relative(resolve(root), testInfo.file).split(sep).join('/');
}

/** The key a worker files one case under: the attempts of a retry share it. */
export function caseKey(owner: string, id: string): string {
  return `${owner}\u0000${id}`;
}
