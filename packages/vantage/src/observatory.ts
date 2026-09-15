/**
 * What a watching process holds, and the only thing in this package that moves.
 *
 * ## Still nothing written down
 *
 * `@variance-authority/event` takes the position that an announcement is a
 * message and not a record: a test waits on it, so it is worth something for the
 * length of one execution and nothing afterwards, and a run that ends leaves the
 * disk it found. Nothing here changes that. There is no report directory, no
 * file to clean up and no artifact to mistake for evidence later — what changes
 * is only *how long one execution lasts when somebody is watching*, because the
 * memory holding it belongs to a process that outlives the test rather than to
 * the test. Stop that process and the evidence is gone, which is the same
 * bargain stated at a different scale.
 *
 * ## Bounded, and it says when it forgot
 *
 * A suite is thousands of tests and a chatty one announces hundreds of times
 * each, so an unbounded store is a watcher that grows until the machine notices.
 * Both bounds drop from the front, and both are counted: a reader that cannot
 * tell "nothing was announced" from "the beginning was forgotten" would draw the
 * first conclusion, which is the one that sends somebody looking for a call that
 * is right there.
 *
 * {@link WatchedTest.pending} is exact whatever was dropped. What is bounded is
 * the list of announcements, not the tally of work that opened and never closed,
 * and the tally is the one an unfinished run is actually asked about.
 */

import type { RecordedEvent } from '@variance-authority/event/collect';
import type { VantageReport } from './report.js';
import type { Note, TestState, VantageState, WatchedTest } from './state.js';

export interface ObservatoryOptions {
  /**
   * Where reports arrive, carried into every answer so a tool with nothing to
   * show can name what to set. A watcher not listening on anything omits it.
   */
  readonly address?: string;
  /** How many tests to keep. Defaults to 200, newest kept. */
  readonly tests?: number;
  /** How many announcements to keep per test. Defaults to 500, newest kept. */
  readonly heard?: number;
  /** How many notes to keep per test. Defaults to 100, newest kept. */
  readonly notes?: number;
}

/** A watcher's memory of a run. */
export interface Observatory {
  /** Take one thing a run said about one test. */
  readonly took: (test: string, report: VantageReport) => void;
  /** The run as it stands now, as plain values that will not change again. */
  readonly snapshot: () => VantageState;
  /**
   * Tell a stopped test to go on, and answer whether there was one to tell.
   *
   * `false` for a test that is not stopped, or is already going: a reader that
   * asked twice must not leave a second release standing, because the run polls
   * and the second one would land on whatever that test stopped at next.
   */
  readonly release: (test: string) => boolean;
  /** Tell everything that is stopped to go on, and answer which tests those were. */
  readonly releaseAll: () => readonly string[];
  /**
   * What a stopped run is answered when it asks whether it may go on.
   *
   * Spends the release rather than reporting it: this is the call that un-stops
   * the test, so the answer and the state change are the same event and no
   * second reader can spend the same release.
   */
  readonly asked: (test: string) => boolean;
}

interface Held {
  title: string;
  file: string;
  project?: string;
  worker: number;
  readonly ordinal: number;
  state: TestState;
  readonly heard: RecordedEvent[];
  forgotten: number;
  /** Coordinates `vaStart` opened and `vaEnd` has not closed. */
  readonly open: Map<string, RecordedEvent>;
  /** Keyed and last-write-wins, the same as the log's own remarks. */
  readonly remarks: Map<string, string>;
  /** Accumulated in arrival order, because two notes are two places. */
  readonly notes: Note[];
  noted: number;
  forgottenNotes: number;
  /**
   * Where this test stopped, while it is stopped.
   *
   * Always present and often `undefined`, rather than optional, because this is
   * the one field that is *cleared* — a release, a close — and an exact optional
   * cannot be assigned the absence it needs to return to.
   */
  waitingAt: string | undefined;
  /**
   * Whether a reader has told it to go on, until the run comes to collect that.
   *
   * Separate from {@link waitingAt} because the two answer different questions —
   * one is what a reader sees, the other is what the run is owed — and reading
   * the second off the first would make every poll its own release.
   */
  releasing: boolean;
  error?: string;
}

export function createObservatory(options: ObservatoryOptions = {}): Observatory {
  const keptTests = options.tests ?? 200;
  const keptHeard = options.heard ?? 500;
  const keptNotes = options.notes ?? 100;
  const held = new Map<string, Held>();
  let opened = 0;
  let forgotten = 0;

  // A report for a test nothing has opened should not happen: reports about one
  // test travel one endpoint and keep their order, and the fixture that opens a
  // test runs before the one that announces in it. It is held anyway, because
  // the alternative is a watcher that drops the evidence for exactly the wiring
  // fault a person would be here to find.
  const entry = (test: string): Held => {
    const found = held.get(test);
    if (found !== undefined) return found;
    const made: Held = {
      title: test,
      file: '',
      worker: -1,
      ordinal: opened,
      state: 'running',
      heard: [],
      forgotten: 0,
      open: new Map(),
      remarks: new Map(),
      notes: [],
      noted: 0,
      forgottenNotes: 0,
      waitingAt: undefined,
      releasing: false,
    };
    opened += 1;
    held.set(test, made);
    while (held.size > keptTests) {
      const oldest = held.keys().next();
      if (oldest.done === true) break;
      held.delete(oldest.value);
      forgotten += 1;
    }
    return made;
  };

  const took = (test: string, report: VantageReport): void => {
    const one = entry(test);
    switch (report.kind) {
      case 'opened':
        one.title = report.title;
        one.file = report.file;
        one.worker = report.worker;
        if (report.project !== undefined) one.project = report.project;
        return;

      case 'heard': {
        const event = report.event;
        one.heard.push(event);
        if (one.heard.length > keptHeard) {
          one.heard.shift();
          one.forgotten += 1;
        }
        const at = coordinate(event);
        if (event.phase === 'start') one.open.set(at, event);
        else if (event.phase === 'end') one.open.delete(at);
        return;
      }

      case 'remarked':
        one.remarks.set(report.about, report.sentence);
        return;

      case 'noted':
        one.notes.push({
          at: report.at,
          note: report.note,
          ordinal: one.noted,
          after: one.forgotten + one.heard.length,
        });
        one.noted += 1;
        if (one.notes.length > keptNotes) {
          one.notes.shift();
          one.forgottenNotes += 1;
        }
        return;

      case 'waiting':
        one.waitingAt = report.at;
        return;

      case 'closed':
        // Whatever it was waiting at, it is not waiting now. A test that ended
        // while a reader still had it listed as stopped would leave a release
        // nobody can ever spend.
        one.waitingAt = undefined;
        one.releasing = false;
        one.state = report.state;
        if (report.error !== undefined) one.error = report.error;
    }
  };

  const release = (test: string): boolean => {
    const one = held.get(test);
    if (one === undefined || one.waitingAt === undefined || one.releasing) return false;
    one.releasing = true;
    return true;
  };

  return {
    took,
    release,
    releaseAll: () => {
      const released: string[] = [];
      for (const id of held.keys()) if (release(id)) released.push(id);
      return released;
    },
    asked: (test) => {
      const one = held.get(test);
      if (one === undefined || !one.releasing) return false;
      one.releasing = false;
      one.waitingAt = undefined;
      return true;
    },
    snapshot: () => ({
      ...(options.address === undefined ? {} : { address: options.address }),
      tests: [...held].map(([id, one]) => watched(id, one)),
      forgotten,
    }),
  };
}

function watched(id: string, one: Held): WatchedTest {
  return {
    id,
    title: one.title,
    file: one.file,
    ...(one.project === undefined ? {} : { project: one.project }),
    worker: one.worker,
    ordinal: one.ordinal,
    state: one.state,
    heard: [...one.heard],
    forgotten: one.forgotten,
    pending: [...one.open.values()],
    remarks: [...one.remarks.values()],
    notes: [...one.notes],
    forgottenNotes: one.forgottenNotes,
    ...(one.waitingAt === undefined ? {} : { waitingAt: one.waitingAt }),
    ...(one.error === undefined ? {} : { error: one.error }),
  };
}

function coordinate(event: RecordedEvent): string {
  return `${event.location} / ${event.subject} / ${event.action}`;
}
