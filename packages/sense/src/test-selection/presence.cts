/**
 * A bucket's read-out as the journal writer takes it: one array per module.
 *
 * Apart from `collectors.cts`, which decides the buckets, so each file holds
 * one responsibility. CommonJS for the reason `journal-format.cts` is.
 */

import probeLog = require('../instrument/probe-log.cjs');
import type { ModuleId } from '../instrument/index.js';

type View = ReturnType<ReturnType<typeof probeLog.createEngine>['read']>;
type Presence = Map<ModuleId, Uint32Array>;

/** Mirrors `EVALUATING` in `../instrument/index.ts`, with the entered bit beside it. */
const ENTERED_EVALUATING = 0x80000001;

/**
 * A read-out as one array per module, 1 for entered and the evaluating bit
 * beside it: what `encodeJournal` reads, and all it reads.
 */
function presenceOf(view: View): Presence {
  const out: Presence = new Map();
  for (const row of view.rows) {
    const counters = new Uint32Array(view.counts[row]!);
    for (let at = view.start[row]!; at < view.end[row]!; at += 1) {
      const value = view.sorted[at]!;
      counters[value >>> 1] = value & 1 ? ENTERED_EVALUATING : 1;
    }
    out.set(view.ids[row]!, counters);
  }
  return out;
}

/**
 * Or a bucket into the file's union. A module whose block count changed
 * restarts from this bucket: its old ordinals name regions the new text does
 * not have.
 */
function foldInto(union: Presence, view: View): void {
  for (const row of view.rows) {
    const id = view.ids[row]!;
    const count = view.counts[row]!;
    let counters = union.get(id);
    if (counters === undefined || counters.length !== count) {
      counters = new Uint32Array(count);
      union.set(id, counters);
    }
    for (let at = view.start[row]!; at < view.end[row]!; at += 1) {
      const value = view.sorted[at]!;
      counters[value >>> 1]! |= value & 1 ? ENTERED_EVALUATING : 1;
    }
  }
}

export = { presenceOf, foldInto };
