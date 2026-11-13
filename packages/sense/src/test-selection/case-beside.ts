/**
 * What a worker writes beside a case's crossings, read as the fold names its
 * cases: the Eyes journals a case handed over, and how each attempt of a
 * retried case ended. Both travel as eyes frames (`eyes-frame.cts`), name
 * their case by the packed coordinate a case frame uses, and are joined to the
 * case's id once the fold has numbered the run.
 */

import { caseKey, unpackCase, type CaseCoordinate } from './cases.js';
import { recordedAttempt, retriedAttempts, type ObservedAttempt, type RecordedAttempt } from './attempts-record.js';
import eyesFrames from './eyes-frame.cjs';
import type { EyesSection, RecordedEyes } from './eyes-record.js';
import { projectPath } from './instrumented-modules.js';

/** The case a frame beside the case frames names. */
export interface BesideCase {
  /** The coordinate's key, as `caseKey` spells it. */
  readonly key: string;
  readonly located: CaseCoordinate;
}

export interface BesideCases {
  /** Keeps what `bytes` says of its case and names the case; `undefined` when `bytes` is a case frame. */
  take(bytes: Uint8Array): BesideCase | undefined;
  /** What Eyes handed each case, by the ids of `ids`; `undefined` when no case opened a journal. */
  eyes(ids: ReadonlyMap<string, string>): EyesSection | undefined;
  /** How the attempts of each retried case ended, by the ids of `ids`; none when no case was retried. */
  attempts(ids: ReadonlyMap<string, string>): readonly RecordedAttempt[];
}

/** A reader of one run's frames, for a checkout at `root`. */
export function besideCases(root: string): BesideCases {
  // What Eyes handed each case, by coordinate key, in the order it arrived.
  const looked = new Map<string, Omit<RecordedEyes, 'case'>[]>();
  const tried = new Map<string, ObservedAttempt[]>();
  return {
    take(bytes) {
      const frame = eyesFrames.decodeEyesFrame(bytes);
      if (frame === undefined) return undefined;
      const coordinate = unpackCase(frame.case);
      const located = { ...coordinate, file: projectPath(root, coordinate.file) };
      const key = caseKey(located);
      if (frame.ended === undefined) {
        const rows = looked.get(key) ?? [];
        if (frame.journal !== undefined) rows.push({ attempt: frame.attempt, journal: frame.journal });
        looked.set(key, rows);
      } else {
        const { attempt, ended, duration, message, stack } = frame;
        const rows = tried.get(key) ?? [];
        rows.push({
          attempt,
          ended,
          ...(duration === undefined ? {} : { duration }),
          ...(message === undefined ? {} : { message }),
          ...(stack === undefined ? {} : { stack }),
        });
        tried.set(key, rows);
      }
      return { key, located };
    },
    eyes: (ids) => (looked.size === 0 ? undefined : {
      watched: [...looked.keys()].map((key) => ids.get(key)!),
      journals: [...looked].flatMap(([key, rows]) => rows.map((row) => ({ case: ids.get(key)!, ...row }))),
    }),
    attempts: (ids) => retriedAttempts([...tried].flatMap(([key, rows]) =>
      rows.map((row) => recordedAttempt(ids.get(key)!, row, root)))),
  };
}
