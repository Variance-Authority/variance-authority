/**
 * Where, when and over which text each test file a `covering` question names
 * last ran, as a walk's record carries it: the runs record beside the
 * snapshot, the committed texts and the texts landings kept.
 *
 * A record carried through landings keeps, for a test that has not run since,
 * when its runs landed and the digest of the text they ran over. A landing
 * that carries it and never ran it must not re-date it or name another text,
 * and the record holds the text behind that digest only while it is kept or
 * committed. What a reader concludes from them is `covering`'s, and is tested
 * there.
 */

import { digestString } from '@variance-authority/core/format';
import { caseSectionsAt } from '../case-record.js';
import { readCommitRuns } from '../commit-runs.js';
import { decodeExecutionIndex } from '../execution-format.js';
import { readTestCoverage } from '../index.js';
import { keptTexts } from '../kept-texts.js';
import { textsAt } from '../recorded-text.js';
import { coveringTests } from '../reverse.js';
import { testPlaces } from '../test-places.js';
import { SUBJECT, type Walk } from './carry-contract.js';

/** A line, or a run of lines, of the subject's text at HEAD. */
export type Asked = { readonly line: number } | { readonly lines: { readonly startLine: number; readonly endLine: number } };

/** Where and when one test file last ran, and the subject's text it ran over, as the record carries them. */
export interface Stood {
  readonly commit: string;
  readonly landed?: { readonly first: string; readonly latest: string; readonly runs?: number };
  /** The digest of the subject's text it ran over: its place's, else the one committed where it ran. Absent when the record does not say. */
  readonly digest?: string;
  /** The text the record holds under `digest`, kept or committed. Absent when it holds none. */
  readonly text?: string;
}

/** A reader of {@link Stood} for each test file the question names. */
export type Ran = (walk: Walk, asked: Asked) => Promise<Readonly<Record<string, Stood>>>;

/**
 * {@link Ran} in-process, through the public readers: the test files are the
 * cases that reached the asked lines (`coveringTests`), each placed by
 * `testPlaces`; the digest is the one its place names, else the committed
 * text's; the text is the one kept under that digest, else the committed one
 * when it has that digest.
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
  const answer: Record<string, Stood> = {};
  for (const test of tests) {
    const place = places.get(test)!;
    const blob = blobs.get(place.commit)?.get(SUBJECT);
    const digest = place.texts === undefined ? undefined : place.texts[SUBJECT] ?? (blob === undefined ? undefined : digestString(blob));
    const text = digest === undefined ? undefined : kept(digest) ?? (blob !== undefined && digestString(blob) === digest ? blob : undefined);
    answer[test] = {
      commit: place.commit,
      ...(place.first === undefined || place.latest === undefined
        ? {}
        : { landed: { first: place.first, latest: place.latest, ...(place.runs === undefined ? {} : { runs: place.runs }) } }),
      ...(digest === undefined ? {} : { digest }),
      ...(text === undefined ? {} : { text }),
    };
  }
  walk.actions.push({ action: 'ran in-process', asked, answer });
  return answer;
}
