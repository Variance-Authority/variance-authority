/**
 * The story of each execution a live head runs, for a head started with
 * `VARIANCE_AUTHORITY_STORY=1`.
 *
 * The tap a test story is read from ([`story-tap.cts`](../instrument/story-tap.cts))
 * already keys every visit and every note by the bucket the engine holds, and a
 * reporting head's buckets are its journeys. So the tap goes in front of the
 * head's engine unchanged, and each journey's story is cut from the one tape by
 * its id, as a case's is by its key. What a live run shows is what its functions
 * were handed: a module's top level says nothing of what it holds.
 *
 * Loaded only when asked, and by `require` from where it was built: the tap and
 * the format are CommonJS that name their neighbours by built names, and a head
 * that was not asked for stories never loads either.
 */

import { createRequire } from 'node:module';
import type probeLog from '../instrument/probe-log.cjs';

type StoryTap = typeof import('../instrument/story-tap.cjs');
type StoryFormat = typeof import('../story/format.cjs');

/** A tape in front of a reporting head's engine. */
export interface JourneyTape {
  /** What the realm's `__VA__` is set to. */
  readonly root: object;
  /**
   * The story of `journey` since it was last told, base64 as the wire carries
   * it. A journey told again, by a promise its request left running, is told
   * only what it ran since.
   */
  storyOf(journey: string): string;
  /** Start the tape again, when no journey is open and everything on it was told. */
  reset(): void;
}

/** Put a tape in front of `engine`, which a scope already keys by journey. */
export function tapeJourneys(engine: ReturnType<typeof probeLog.createEngine>): JourneyTape {
  const require = createRequire(import.meta.url);
  const storyTap = require('../instrument/story-tap.cjs') as StoryTap;
  const format = require('../story/format.cjs') as StoryFormat;
  const tap = storyTap.createTap(engine, storyTap.TAPE_LIMIT, false);
  tap.nameIn(globalThis);
  // How many segments and notes the tape held when each journey was last told.
  const told = new Map<string, readonly [segments: number, notes: number]>();
  // A segment already told is nobody's now, and other work to the journey told again.
  const ELSEWHERE = '\u0000told';
  return {
    root: tap.root,
    storyOf(journey) {
      const tape = tap.read();
      const [segments, notes] = told.get(journey) ?? [0, 0];
      told.set(journey, [tape.keys.length, tape.notes.length]);
      const since = {
        ...tape,
        keys: tape.keys.map((key, at) => (at < segments && key === journey ? ELSEWHERE : key)),
        notes: tape.notes.filter((note, at) => at >= notes || note[1] !== journey),
        held: new Map(),
      };
      return format.encodeStory(since, journey).toString('base64');
    },
    reset() {
      tap.reset();
      told.clear();
    },
  };
}
