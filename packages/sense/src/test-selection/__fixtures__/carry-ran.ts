/**
 * Where, when and over which text each test file a `covering` question names
 * last ran, as a walk's record carries it: the runs record beside the
 * snapshot, the committed texts and the texts landings kept.
 *
 * A record carried through landings keeps, for a test that has not run since,
 * when its runs landed and the text they ran over. A landing that carries it
 * and never ran it must not re-date it or say it ran over another text, and
 * the record holds that text only while it is kept or committed. Each reader
 * says it in the words `covering` prints, which name no digest; what a reader
 * concludes of a region is `covering`'s, and is tested there.
 */

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { digestString } from '@variance-authority/core/format';
import { caseSectionsAt } from '../case-record.js';
import { readCommitRuns } from '../commit-runs.js';
import { decodeExecutionIndex } from '../execution-format.js';
import { readTestCoverage } from '../index.js';
import { keptTexts } from '../kept-texts.js';
import { textsAt } from '../recorded-text.js';
import { coveringTests } from '../reverse.js';
import { testPlaces } from '../test-places.js';
import { BIN, cliEnv, indexedByCli, SUBJECT, type Walk } from './carry-contract.js';

/** A line, or a run of lines, of the subject's text at HEAD. */
export type Asked = { readonly line: number } | { readonly lines: { readonly startLine: number; readonly endLine: number } };

/** Where and when one test file last ran, and over which of the subject's texts, as the record carries them. */
export interface Stood {
  readonly commit: string;
  readonly landed?: { readonly first: string; readonly latest: string; readonly runs?: number };
  /** `asked` when it ran over the subject's text in the tree, `other` over another one; absent when the record does not say. */
  readonly text?: 'asked' | 'other';
  /** With `other`: whether the record holds that text, kept or committed, so a region of it can be read in it. */
  readonly held?: boolean;
}

/** The part of a `covering --format json` `ran` stand {@link ranByCli} reads. */
interface RanStand {
  readonly commit: string;
  readonly tests: readonly string[];
  readonly landed?: Stood['landed'];
  readonly text?: 'held' | 'other';
  readonly region?: string | { readonly unknown: string };
}

/** A reader of {@link Stood} for each test file the question names. */
export type Ran = (walk: Walk, asked: Asked) => Promise<Readonly<Record<string, Stood>>>;

/**
 * {@link Ran} in-process, through the public readers: the test files are the
 * cases that reached the asked lines (`coveringTests`), each placed by
 * `testPlaces`; the text it ran over is the one whose digest its place names,
 * else the one committed where it ran, held when a landing kept it or that
 * commit has it.
 */
export async function ranInProcess(walk: Walk, asked: Asked): Promise<Readonly<Record<string, Stood>>> {
  const { commit } = await readTestCoverage(walk.coverageFile);
  const index = decodeExecutionIndex(caseSectionsAt(walk.coverageFile).index!);
  const lines = 'line' in asked ? { startLine: asked.line, endLine: asked.line } : asked.lines;
  const recorded = Array.from({ length: lines.endLine - lines.startLine + 1 }, (_, at) => lines.startLine + at);
  const tests = [...new Set(coveringTests(index, { file: SUBJECT, lines: recorded }).map((test) => test.file))].sort();
  const { places } = testPlaces({ commit: commit!, runs: await readCommitRuns(walk.coverageFile), tests });
  const blobs = textsAt(walk.root, new Map([...places.values()].map((place) => [place.commit, [SUBJECT]])));
  const kept = keptTexts(walk.root, walk.cacheRoot);
  const inTree = digestString(await readFile(join(walk.root, SUBJECT), 'utf8'));
  const answer: Record<string, Stood> = {};
  for (const test of tests) {
    const place = places.get(test)!;
    const blob = blobs.get(place.commit)?.get(SUBJECT);
    const digest = place.texts === undefined ? undefined : place.texts[SUBJECT] ?? (blob === undefined ? undefined : digestString(blob));
    answer[test] = {
      commit: place.commit,
      ...(place.first === undefined || place.latest === undefined
        ? {}
        : { landed: { first: place.first, latest: place.latest, ...(place.runs === undefined ? {} : { runs: place.runs }) } }),
      ...(digest === undefined
        ? {}
        : digest === inTree
          ? { text: 'asked' as const }
          : { text: 'other' as const, held: kept(digest) !== undefined || (blob !== undefined && digestString(blob) === digest) }),
    };
  }
  walk.actions.push({ action: 'ran in-process', asked, answer });
  return answer;
}

/**
 * {@link Ran} asked of `variance covering --format json` in a process of its
 * own, after `variance index` has indexed HEAD, from its `ran` stands: `held`
 * there is the asked text, and a region whose verdict is not known is one read
 * in no text the record holds.
 */
export async function ranByCli(walk: Walk, asked: Asked): Promise<Readonly<Record<string, Stood>>> {
  const line = 'line' in asked ? String(asked.line) : `${String(asked.lines.startLine)}-${String(asked.lines.endLine)}`;
  await indexedByCli(walk);
  const { stdout } = await promisify(execFile)(process.execPath, [BIN, 'covering', '--file', SUBJECT, '--line', line, '--execution', walk.coverageFile, '--format', 'json'], {
    cwd: walk.root, env: cliEnv(walk), maxBuffer: 64 * 1024 * 1024,
  });
  const { ran } = JSON.parse(stdout) as { readonly ran: { readonly stands: readonly RanStand[] } };
  const answer = Object.fromEntries(ran.stands.flatMap(({ commit, tests, landed, text, region }) => tests.map((test): [string, Stood] => [test, {
    commit,
    ...(landed === undefined ? {} : { landed }),
    ...(text === 'held' ? { text: 'asked' } : text === 'other' ? { text: 'other', ...(region === undefined ? {} : { held: typeof region !== 'object' }) } : {}),
  }])));
  walk.actions.push({ action: 'ran through the CLI', asked, stdout });
  return answer;
}
