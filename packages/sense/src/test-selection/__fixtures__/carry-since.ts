/**
 * What `covering --since` reads of a walk's record: the test files that entered
 * what the change changed, the change being the merge base's diff to the tree
 * and the record only saying how to read it. The translation is the CLI's, so
 * the in-process reader calls the built one and the other runs it cold.
 */

import { execFile } from 'node:child_process';
import { rename } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { caseSectionsAt } from '../case-record.js';
import { decodeExecutionIndex } from '../execution-format.js';
import { readTestCoverage } from '../index.js';
import { coveringChange } from '../reverse.js';
import type { LineRange } from '../diff-lines.js';
import { BIN, cliEnv, ELSEWHERE_TEST, indexedByCli, SUBJECT, type Walk } from './carry-contract.js';

const run = promisify(execFile);
const COVERING_SINCE = pathToFileURL(resolve(import.meta.dirname, '../../../../cli/dist/commands/covering-since.js')).href;

/** A reader of the test files that entered what changed since `since`. */
export type Since = (walk: Walk, since: string) => Promise<readonly string[]>;

/** The part of `covering-since.ts` {@link sinceInProcess} calls. */
interface CoveringSince {
  listedChange(since: string): Promise<unknown>;
  changeSince(listed: unknown, since: string, root: string, at: string): Promise<{ readonly lines: ReadonlyMap<string, readonly LineRange[]> }>;
}

/** The part of a changed region this reads. A change inside a nested region lists every region around it. */
interface Region {
  readonly startLine: number;
  readonly endLine: number;
  readonly tests: readonly { readonly file: string }[];
}

/** The test files of the regions nothing listed stands inside: the ones that entered the change itself. */
function entered(changed: readonly { readonly regions: readonly Region[] }[]): readonly string[] {
  const inner = changed.flatMap(({ regions }) => regions.filter((region) => !regions.some((other) => other !== region && region.startLine <= other.startLine && other.endLine <= region.endLine)));
  return [...new Set(inner.flatMap(({ tests }) => tests.map((test) => test.file)))].filter((test) => test !== ELSEWHERE_TEST).sort();
}

/** {@link Since} in-process: the CLI's change read in the record's numbers, joined to the record. */
export async function sinceInProcess(walk: Walk, since: string): Promise<readonly string[]> {
  const { listedChange, changeSince } = await import(/* @vite-ignore */ COVERING_SINCE) as CoveringSince;
  const { commit } = await readTestCoverage(walk.coverageFile);
  const index = decodeExecutionIndex(caseSectionsAt(walk.coverageFile).index!);
  const from = process.cwd();
  process.chdir(walk.root);
  try {
    const { lines } = await changeSince(await listedChange(since), since, walk.root, commit!);
    walk.actions.push({ action: 'since in-process', since, lines: [...lines] });
    return entered(coveringChange(index, lines));
  } finally {
    process.chdir(from);
  }
}

/** {@link sinceInProcess}, asked of `variance covering --since` in a process of its own that opens the record cold. */
export async function sinceByCli(walk: Walk, since: string): Promise<readonly string[]> {
  await indexedByCli(walk);
  const { stdout } = await run(process.execPath, [BIN, 'covering', '--since', since, '--execution', walk.coverageFile, '--format', 'json'], {
    cwd: walk.root, env: cliEnv(walk), maxBuffer: 64 * 1024 * 1024,
  });
  walk.actions.push({ action: 'since through the CLI', since, stdout });
  return entered((JSON.parse(stdout) as { readonly changed: readonly { readonly regions: readonly Region[] }[] }).changed);
}

/** The subject moved to `to` and committed, its text unchanged: the walk's record keeps the name it ran under. */
export async function renamedSubject(walk: Walk, to: string): Promise<string> {
  await rename(resolve(walk.root, SUBJECT), resolve(walk.root, to));
  await run('git', ['add', '--all'], { cwd: walk.root });
  await run('git', ['commit', '--quiet', '--message', 'the subject renamed'], { cwd: walk.root });
  const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: walk.root });
  walk.actions.push({ action: 'rename', to });
  return stdout.trim();
}
