/**
 * `@variance-authority/oxc` — the file graph, read off a disk.
 *
 * [`core/relate`](../../core/src/relate) holds the structure and answers the
 * questions; it performs no I/O and depends on nothing (ADR-0006). This is the
 * half that opens files: an `oxc` parse for the module record, a resolver for
 * turning a specifier into a path, and a walk that follows what it finds.
 *
 * It is separate because it is the expensive, replaceable half. A repository that
 * already computes this — `nx`, `turbo`, a bundler's own graph — can produce
 * `FileRecord`s from that instead, hand them to the same fold, and every question
 * downstream is answered identically.
 *
 * ## The one rule
 *
 * A file whose outgoing edges cannot be enumerated says so, and every consumer
 * treats it as though it changed. Under-reporting an edge does not produce a
 * smaller answer, it produces a **wrong** one: a green run over a surface nobody
 * looked at. Over-reporting one costs a collection.
 */

export {
  MODULE_EXTENSIONS,
  STYLE_EXTENSIONS,
  readModule,
  readStyle,
  type Read,
  type Specifier,
} from './read.js';

export { scanRelations, type ScanOptions } from './scan.js';

export {
  memoryParseCache,
  openParseCache,
  type Parsed,
  type ParseCache,
  type PersistentParseCache,
} from './cache.js';

export {
  layoutOf,
  memoryRecordCache,
  openRecordCache,
  type RecordCache,
  type PersistentRecordCache,
} from './reuse.js';

export { gitDigests } from './tree.js';
