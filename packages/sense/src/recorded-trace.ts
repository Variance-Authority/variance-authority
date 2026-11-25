/**
 * What a recorded run holds that a timeline needs: each test file with when the
 * runner started it, what it cost, where that went by phase, and the cases it
 * declared with the time each took.
 *
 * Each figure is the one the runner reported, read where the record's other
 * readers read it (`costs`, `fileCost`); a figure it did not report is absent,
 * never lent a width from its neighbours. Where a case began is not recorded,
 * so a caller that places cases places them itself.
 */

// compass: variance-authority.reach

import { existsSync, readFileSync } from 'node:fs';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { keepsCases } from './test-selection/case-record.js';
import { askCoverageFile } from './test-selection/coverage-file.js';
import { decodeExecutionTests } from './test-selection/execution-format.js';
import { NO_DURATION, PHASE_NAMES } from './test-selection/format-layout.js';
import { startAt } from './test-selection/format.js';
import { nearestRecord } from './test-selection/record-location.js';
import { costs, takenAt } from './recorded-durations.js';

/** One phase of a test file and the milliseconds the runner timed it at. */
export interface TracedPhase {
  readonly name: (typeof PHASE_NAMES)[number];
  readonly ms: number;
}

/** One case a file declares and the milliseconds its runner reported for it. */
export interface TracedCase {
  readonly name: string;
  readonly duration: number;
}

/** One recorded test file, with each figure the runner gave and none it did not. */
export interface TracedFile {
  readonly file: string;
  /** Milliseconds since the epoch the runner started the file at, its earliest attempt. */
  readonly start?: number;
  /** What running the file cost, as `fileCost` reads it. */
  readonly cost?: number;
  /** The phases the runner timed, in the order they run. */
  readonly phases: readonly TracedPhase[];
  /** The timed cases, in the order the index holds them; empty where no run kept its cases. */
  readonly cases: readonly TracedCase[];
}

/** A recorded run as a timeline reads it, or why there is none to read. */
export type RecordedTrace =
  | {
      readonly recording: string;
      readonly commit?: string;
      /** When the record's latest run landed, as ISO 8601; absent where it is not known. */
      readonly landed?: string;
      /** Every recorded file in code-unit order of path. */
      readonly files: readonly TracedFile[];
    }
  | { readonly recording: string; readonly unread: string };

/** The nearest recording of `suite` under `root`, laid out for a timeline. */
export function recordedTrace(root: string, suite?: string): RecordedTrace {
  const { file: recording } = nearestRecord(root, { suite });
  if (!existsSync(recording)) return { recording, unread: 'nothing is recorded there' };
  try {
    const casesOf = new Map<string, TracedCase[]>();
    if (keepsCases(recording)) {
      for (const test of decodeExecutionTests(readFileSync(recording))) {
        if (test.duration === undefined) continue;
        const held = casesOf.get(test.file) ?? [];
        held.push({ name: test.name, duration: test.duration });
        casesOf.set(test.file, held);
      }
    }
    const read = askCoverageFile(recording, (view) => {
      const paths = view.testPath.all();
      const costOf = costs(view);
      const phases = view.testPhases?.all();
      const starts = view.testStart?.all();
      const width = PHASE_NAMES.length;
      const files = Array.from(paths, (path, test): TracedFile => {
        const file = view.string(path);
        const words = phases?.subarray(test * width, (test + 1) * width);
        const cost = costOf(test);
        return {
          file,
          ...startAt(starts, test),
          ...(cost === undefined ? {} : { cost }),
          phases: PHASE_NAMES.flatMap((name, at) => (words === undefined || words[at] === NO_DURATION ? [] : [{ name, ms: words[at]! }])),
          cases: casesOf.get(file) ?? [],
        };
      });
      return { files: files.sort((left, right) => codeUnitOrder(left.file, right.file)), commit: view.commit };
    });
    return { recording, ...takenAt(recording, read.commit), files: read.files };
  } catch (error) {
    return { recording, unread: error instanceof Error ? error.message : String(error) };
  }
}
