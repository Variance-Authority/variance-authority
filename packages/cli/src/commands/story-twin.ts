// compass: variance-authority/runtime/attention
/**
 * A case set against its twin.
 *
 * Two cases of one file that differ by one precondition — the flag on, the
 * flag off — are the comparison a failure under one of them asks for: *where
 * do they part*. The record already knows which case is the other one: what
 * each case said, read on the axes `names.axes` declares, places it, and
 * `caseTwins` walks one step toward the base among the cases of its file. Its
 * stories already know where each went. This joins the two: the case's
 * readings under what it said, against its twin's under the value one step
 * toward the base.
 *
 * The record is the one the story was taped beside, so the preconditions read
 * are the run's that wrote it, and no suite has to be named.
 */

import { dirname } from 'node:path';
import { compareReadings, recordOfStories, STORY_VARIABLE, type Comparison, type StoryEntry } from '@variance-authority/sense/story';
import { caseSectionsAt, caseTwins, decodeExecutionIndex, type CaseTwin, type ExecutionTest } from '@variance-authority/sense/test-selection';
import { namesAt } from './covering-where.js';
import type { Unmatched } from './story-compare.js';

/** A comparison with its twin, and the twin it was read against. */
export interface TwinComparison {
  readonly comparison: Comparison;
  readonly twin: CaseTwin;
}

/**
 * The case's readings, newest first, against its twin's among `all`. When it
 * has no twin, or the twin no story, the newest reading is drawn alone with
 * the reason beside it.
 */
export async function compareTwin(root: string, readings: readonly StoryEntry[], all: readonly StoryEntry[]): Promise<TwinComparison | Unmatched> {
  const newest = readings[0]!;
  const alone = (missing: string): Unmatched => ({ alone: newest, unmatched: `nothing to compare it with: ${missing}` });
  const names = await namesAt(root);
  if (names === undefined || names.axes.length === 0) return alone('the root variance.config.json declares no `names.axes`, so no case has a twin');
  const tests = recordedCases(recordOfStories(dirname(newest.path)));
  const own = tests.find((test) => test.file === newest.file && test.name === newest.name);
  if (own?.said === undefined) return alone('the record beside its story holds no preconditions for it, so it has no twin');
  const [twin] = caseTwins([own], tests.filter((test) => test.file === own.file), names);
  if (twin === undefined) return alone('it said no value off the base of any axis `names.axes` declares, so it has no twin');
  const at = `${twin.axis}=${twin.to}`;
  if (twin.twins.length === 0) return alone(`no case in its file is recorded at ${at}`);
  const others = tests.filter((test) => twin.twins.includes(test.id));
  const theirs = all.filter((entry) => others.some((test) => test.file === entry.file && test.name === entry.name));
  if (theirs.length === 0) {
    const named = others.map((test) => test.name).join(', ');
    return alone(`its ${twin.twins.length === 1 ? 'twin' : 'twins'} at ${at}, ${named}, ${twin.twins.length === 1 ? 'has' : 'have'} no story here; run ${twin.twins.length === 1 ? 'it' : 'them'} with ${STORY_VARIABLE}=1`);
  }
  const comparison = compareReadings(root, { name: `${twin.axis}=${twin.from}`, readings }, { name: at, readings: theirs });
  return { comparison, twin };
}

/** The cases the record at `record` holds, or none when it kept no index. */
function recordedCases(record: string): readonly ExecutionTest[] {
  const { index } = caseSectionsAt(record, ['index']);
  return index === undefined ? [] : decodeExecutionIndex(index).tests;
}
