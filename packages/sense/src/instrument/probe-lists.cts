/**
 * A probe log's read-out as lists of ordinals, one entry per module: what a
 * page drain and a journey report, where a case writes its frame from the
 * read-out itself (`test-selection/journal-format.cts`).
 *
 * {@link lists} names nothing outside itself, for the reason the engine does:
 * `test-selection/probes.ts` sends its source to the page beside the engine's.
 * CommonJS for the reason `probe-log.cts` is.
 */

import type { ModuleId } from './index.js';
import type probeLog = require('./probe-log.cjs');

/** What `read`, `take` and `close` hand back, until the engine's next read. */
type ReadOut = ReturnType<ReturnType<typeof probeLog.createEngine>['read']>;

/**
 * A read-out as rows of ordinals: `shared` entered while a module evaluated,
 * `again` those also entered while none did. `byRow` orders by the realm's
 * registration rather than this bucket's first touch, so a page drained several
 * times reports one order.
 */
function lists(out: ReadOut, byRow: boolean): { id: ModuleId; hits: number[]; shared: number[]; again: number[] }[] {
  const order = byRow ? [...out.rows].sort((left, right) => left - right) : out.rows;
  return order.map((row) => {
    const hits: number[] = [];
    const shared: number[] = [];
    const again: number[] = [];
    for (let at = out.start[row]!; at < out.end[row]!; at += 1) {
      const ordinal = out.sorted[at]! >>> 1;
      if (hits[hits.length - 1] === ordinal) again.push(ordinal);
      else hits.push(ordinal);
      if (out.sorted[at]! & 1) shared.push(ordinal);
    }
    return { id: out.ids[row]!, hits, shared, again };
  });
}

export = { lists };
