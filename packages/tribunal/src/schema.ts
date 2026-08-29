/**
 * The version this deployment is on, and the one call that puts a database there.
 *
 * The statements themselves are in [`migrations.ts`](./migrations.js) — this is
 * the reading of them: which version they land on, what a fresh database gets,
 * and the batch that applies it. They were one module until the steps outgrew
 * it, and the ten lines at the bottom of this file are the part an operator is
 * usually looking for.
 */

import type { D1Like } from './bindings.js';
import { INITIAL, MIGRATIONS } from './migrations.js';

/** Bumped when the stored shape changes in a way an older build would misread. */
export const SCHEMA_VERSION = 10;

export { INITIAL, INITIAL_VERSION, MIGRATIONS } from './migrations.js';

/**
 * Every statement, in order — the initial set followed by each step.
 *
 * This is what a fresh database gets, and what the tests run against. The split
 * between them is about *deployment*; nothing downstream of here needs to know a
 * database was built in more than one sitting.
 */
export const SCHEMA: readonly string[] = [...INITIAL, ...MIGRATIONS.flat()];

/**
 * Create the schema, once, in one batch.
 *
 * Exported for the operator to call from `wrangler d1 execute` equivalents or
 * from a one-off route they mount themselves — **not** called by the Worker on
 * request. A handler that migrates on first use is a handler that migrates
 * concurrently under load, and D1 has no advisory lock to serialize it with.
 *
 * Applying it twice fails on the first `CREATE TABLE`, which is the intended
 * behaviour: an operator who cannot tell whether the schema is applied should get
 * an error rather than a silent no-op that might have half-applied.
 */
export async function applySchema(db: D1Like): Promise<void> {
  await db.batch(SCHEMA.map((statement) => db.prepare(statement)));
}
