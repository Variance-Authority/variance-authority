// compass: variance-authority.reach.story
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
 * A head serves for as long as it runs and may never be idle, so the tap keeps
 * each journey's part apart and lets it go once it is told: what it holds is
 * what is open, and telling one journey reads that journey's part alone.
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
   * it, and the tape lets it go. A journey told again, by a promise its request
   * left running, is told only what it ran since.
   */
  storyOf(journey: string): string;
  /** Let go of what `journey` ran since it was last told, for an account nobody reads a story of. */
  forget(journey: string): void;
}

/** Put a tape in front of `engine`, which a scope already keys by journey. */
export function tapeJourneys(engine: ReturnType<typeof probeLog.createEngine>): JourneyTape {
  // Loaded here, not imported: a head not asked for stories never loads the tap
  // or the format, and `journey.ts`, which every head and its unit tests load
  // from source, would otherwise pull in the tap, whose `require` of its
  // CommonJS neighbours names built files that exist only in `dist`.
  const require = createRequire(import.meta.url);
  const storyTap = require('../instrument/story-tap.cjs') as StoryTap;
  const format = require('../story/format.cjs') as StoryFormat;
  const tap = storyTap.createTap(engine, storyTap.PART_LIMIT, true);
  tap.nameIn(globalThis);
  return {
    root: tap.root,
    storyOf: (journey) => format.encodeStory(tap.take(journey), journey).toString('base64'),
    forget: (journey) => void tap.take(journey),
  };
}
