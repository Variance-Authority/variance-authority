import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lastCaseRunOf } from './case-landing.js';
import { caseSectionsOf } from './case-record.js';

/** The base of a run that read no record and was laid over none. */
export const NO_BASE = 'none';

/**
 * A record as a base names it: the `sha256:` digest of its bytes. Not
 * `digestBytes`: its `v1:` digest keeps 32 hex digits, and the base is the
 * whole SHA-256, as `record_start.rs` reads it.
 */
export function recordDigest(bytes: Uint8Array): string {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/** The record at `file` as a base names it, read from disk. */
export function recordDigestAt(file: string): string {
  return recordDigest(readFileSync(file));
}

const READS = Symbol.for('variance-authority.test-selection.reads');

/**
 * `ask`, a reading of a record that a run chooses its tests by — its selection,
 * or the times a shard places its files by — noting the record it read, when
 * it read one, against the record the run lands in. The landing names it in
 * the base ({@link recordBase}). The latest reading noted stands, so a runner
 * that watches names the record its last run read.
 */
export function notingRead<T extends object>(landing: string, ask: () => Promise<T>): () => Promise<T> {
  return async () => {
    const got = await ask();
    const read = (got as { readonly read?: unknown }).read;
    if (typeof read === 'string') {
      const carrier = globalThis as { [READS]?: Map<string, string> };
      (carrier[READS] ??= new Map<string, string>()).set(landing, read);
    }
    return got;
  };
}

/** The record the run landing in `landing` chose its tests from, when it read one. */
export function readFor(landing: string): string | undefined {
  return (globalThis as { [READS]?: Map<string, string> })[READS]?.get(landing);
}

/** Between the record a run read and the record it was laid over, in a base. */
const OVER = ' over ';

/**
 * Where a run started, as the record it writes names it in its `base` part:
 * the record its selection and its placement by time read, and the record it
 * was laid over, each `none` or a `sha256:` digest ({@link recordDigest}).
 * One of them alone when they are one record, so a run that read no record
 * and was laid over none names `none`; otherwise `<read> over <laid>`.
 *
 * The first run at a commit names them; a later run at that commit — the next
 * process of one shard — carries the base it finds, since what it reads and
 * lays over is what the shard itself wrote. Combining refuses shards that
 * name two reads, or two records laid over (`native/src/record_start.rs`).
 *
 * `previous` is the record the run is laid over, `commit` the commit the run
 * ran at, `covered` the commit of the coverage `previous` holds, which a
 * record whose runs kept no cases is at, and `read` the record the run read.
 */
export function recordBase(previous: Uint8Array | undefined, commit: string | undefined, covered: string | undefined, read?: string): Uint8Array {
  if (previous !== undefined) {
    const sections = caseSectionsOf(previous);
    const again = commit !== undefined && (lastCaseRunOf(sections)?.commit === commit || covered === commit);
    if (again && sections.base !== undefined) return sections.base;
  }
  const laid = previous === undefined ? NO_BASE : recordDigest(previous);
  const chose = read ?? NO_BASE;
  return Buffer.from(chose === laid ? laid : `${chose}${OVER}${laid}`);
}
