import { createHash } from 'node:crypto';
import { lastCaseRunOf } from './case-landing.js';
import { caseSectionsOf } from './case-record.js';

/** The base of a run laid over no record. */
export const NO_BASE = 'none';

/**
 * The record a run started from, as the record it writes names it in its
 * `base` part: `none` when it was laid over no record, and otherwise the
 * `sha256:` digest of the bytes of the record the first run at its commit was
 * laid over. A later run at that commit — the next process of one shard —
 * carries the base it finds, so every run of one shard names the record the
 * shard restored. Combining refuses shards that name two
 * (`native/src/record_start.rs`).
 *
 * `previous` is the record the run is laid over, `commit` the commit the run
 * ran at, and `covered` the commit of the coverage `previous` holds, which a
 * record whose runs kept no cases is at.
 */
export function recordBase(previous: Uint8Array | undefined, commit: string | undefined, covered: string | undefined): Uint8Array {
  if (previous === undefined) return Buffer.from(NO_BASE);
  const sections = caseSectionsOf(previous);
  const again = commit !== undefined && (lastCaseRunOf(sections)?.commit === commit || covered === commit);
  if (again && sections.base !== undefined) return sections.base;
  // Not `digestBytes`: its `v1:` digest keeps 32 hex digits, and the base is
  // the whole SHA-256 spelled `sha256:`, as `record_start.rs` reads it.
  return Buffer.from(`sha256:${createHash('sha256').update(previous).digest('hex')}`);
}
