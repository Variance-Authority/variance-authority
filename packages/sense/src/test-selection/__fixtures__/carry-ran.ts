/**
 * Where, when and over which text each test file a `covering` question names
 * last ran, read off a walk's record: the runs record beside the snapshot, the
 * committed texts and the texts landings kept.
 *
 * A record carried through landings keeps, for a test that has not run since,
 * when its runs landed and which text they ran over. A landing that carries it
 * and never ran it must not re-date it, and a text the record cannot produce
 * must not let a region be called the same in both.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { digestString } from '@variance-authority/core/format';
import { caseSectionsAt } from '../case-record.js';
import { readCommitRuns } from '../commit-runs.js';
import { decodeExecutionIndex } from '../execution-format.js';
import { readTestCoverage } from '../index.js';
import { keptTexts } from '../kept-texts.js';
import { placeAcross } from '../placed.js';
import { textsAt } from '../recorded-text.js';
import { coveringTests } from '../reverse.js';
import { testPlaces } from '../test-places.js';
import { BIN, cliEnv, SUBJECT, type Walk } from './carry-contract.js';

const run = promisify(execFile);

/** A line, or a run of lines, of the subject's text at HEAD. */
export type Asked = { readonly line: number } | { readonly lines: { readonly startLine: number; readonly endLine: number } };

/** Where and when one test file last ran, and whether over the subject's text at HEAD. */
export interface Stood {
  readonly commit: string;
  /** `unknown` when the record cannot say which text it ran over. */
  readonly text: 'held' | 'other' | 'unknown';
  /** With `other`: whether the asked lines are the same in both texts. */
  readonly region?: 'same' | 'changed' | 'unknown';
  readonly landed?: { readonly first: string; readonly latest: string; readonly runs?: number };
}

/** A reader of {@link Stood} for each test file the question names. */
export type Ran = (walk: Walk, asked: Asked) => Promise<Readonly<Record<string, Stood>>>;

/**
 * {@link Ran} in-process, through the public readers. It mirrors `ranOf` in
 * `packages/cli/src/commands/covering-ran.ts` for a record that names its
 * commit and a runs record that observed every test: the test files are the
 * cases that reached the asked lines (`coveringTests`), each placed by
 * `testPlaces`; the text it ran over is the one its place names, else the
 * committed one; the region is compared through `placeAcross` with the text
 * kept or committed under that digest.
 */
export async function ranInProcess(walk: Walk, asked: Asked): Promise<Readonly<Record<string, Stood>>> {
  const { commit } = await readTestCoverage(walk.coverageFile);
  const index = decodeExecutionIndex(caseSectionsAt(walk.coverageFile).index!);
  const lines = 'line' in asked ? { startLine: asked.line, endLine: asked.line } : asked.lines;
  const recorded = Array.from({ length: lines.endLine - lines.startLine + 1 }, (_, at) => lines.startLine + at);
  const tests = [...new Set(coveringTests(index, { file: SUBJECT, lines: recorded }).map((test) => test.file))].sort();
  const { places } = testPlaces({ commit: commit!, runs: await readCommitRuns(walk.coverageFile), tests });
  const held = await readFile(resolve(walk.root, SUBJECT), 'utf8');
  const blobs = textsAt(walk.root, new Map([...places.values()].map((place) => [place.commit, [SUBJECT]])));
  const kept = keptTexts(walk.root, walk.cacheRoot);
  const answer: Record<string, Stood> = {};
  for (const test of tests) {
    const place = places.get(test)!;
    const blob = blobs.get(place.commit)?.get(SUBJECT);
    const digest = place.texts === undefined ? undefined : place.texts[SUBJECT] ?? (blob === undefined ? undefined : digestString(blob));
    const landed = place.first === undefined || place.latest === undefined
      ? {}
      : { landed: { first: place.first, latest: place.latest, ...(place.runs === undefined ? {} : { runs: place.runs }) } };
    if (digest === undefined || digest === digestString(held)) {
      answer[test] = { commit: place.commit, text: digest === undefined ? 'unknown' : 'held', ...landed };
      continue;
    }
    const text = kept(digest) ?? (blob !== undefined && digestString(blob) === digest ? blob : undefined);
    const region = text === undefined ? 'unknown' : placeAcross(held, text)(lines)?.moved === false ? 'same' : 'changed';
    answer[test] = { commit: place.commit, text: 'other', region, ...landed };
  }
  walk.actions.push({ action: 'ran in-process', asked, answer });
  return answer;
}

/** One stand of a `covering --format json` answer's `ran`. */
interface CliStand {
  readonly commit: string;
  readonly tests: readonly string[];
  readonly text?: 'held' | 'other';
  readonly region?: 'same' | 'changed' | { readonly unknown: string };
  readonly landed?: Stood['landed'];
}

/** {@link ranInProcess}, asked of `variance covering --line` in a process of its own that opens the record cold. */
export async function ranByCli(walk: Walk, asked: Asked): Promise<Readonly<Record<string, Stood>>> {
  const line = 'line' in asked ? String(asked.line) : `${String(asked.lines.startLine)}-${String(asked.lines.endLine)}`;
  const { stdout } = await run(process.execPath, [BIN, 'covering', '--file', SUBJECT, '--line', line, '--execution', walk.coverageFile, '--format', 'json'], {
    cwd: walk.root, env: cliEnv(walk), maxBuffer: 64 * 1024 * 1024,
  });
  walk.actions.push({ action: 'ran through the CLI', asked, stdout });
  const { ran } = JSON.parse(stdout) as { readonly ran?: { readonly stands?: readonly CliStand[] } };
  const answer: Record<string, Stood> = {};
  for (const stand of ran?.stands ?? []) {
    for (const test of stand.tests) {
      answer[test] = {
        commit: stand.commit,
        text: stand.text ?? 'unknown',
        ...(stand.region === undefined ? {} : { region: typeof stand.region === 'string' ? stand.region : 'unknown' }),
        ...(stand.landed === undefined ? {} : { landed: stand.landed }),
      };
    }
  }
  return answer;
}
