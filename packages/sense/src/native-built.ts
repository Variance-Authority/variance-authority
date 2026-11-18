/**
 * The records one native batch built, in the shapes TypeScript keeps.
 *
 * `built` in [`record.rs`](../native/src/record.rs) is the one rule a record is
 * assembled by, for a batch, a walk and a warm update alike: a guess that lands
 * is an edge and one that misses is silence, every further file a request
 * reaches is an edge of the request's kind, and a miss is a hole only where the
 * file's own language spells a path in this repository. The batch hands its
 * records over built, and this only decodes them.
 */
import type { FileRecord } from '@variance-authority/core/relate';
import type { Digest } from '@variance-authority/core/format';
import type { Parsed } from './cache.js';
import { CODE_EXTENSIONS } from './language.js';
import { BUILTINS } from './native-index-graph.js';
import type { NativeBuilt, NativeFrontierOptions, NativeRecordOptions, NativeScanBatch } from './native.js';

/** `Indexed` in `record.rs`: a target that resolved nowhere crosses as `null`. */
interface Crossed {
  readonly record: FileRecord;
  readonly witnesses: readonly string[];
  readonly targets?: readonly (string | null)[];
}

/** What the batch settles its records against, and the digest each asked file is named by. */
export function recordOptions(options: NativeFrontierOptions, identities?: readonly (Digest | undefined)[]): NativeRecordOptions {
  return {
    remembering: options.remembering,
    ...(options.aliases === undefined ? {} : { aliases: JSON.stringify(options.aliases.table) }),
    builtins: BUILTINS,
    codeExtensions: CODE_EXTENSIONS,
    // A witness is only checked against them when records are kept for reuse.
    directories: options.remembering ? [...options.directories.keys()] : [],
    ...(identities === undefined ? {} : { identities: identities.map((digest) => digest ?? '') }),
  };
}

/** Every row of `batch` as the record the addon built for it, in row order. */
export function builtFromBatch(batch: NativeScanBatch): readonly NativeBuilt[] {
  if (batch.records === undefined) throw new Error('sense: the native batch was asked for records and built none');
  const crossed = JSON.parse(batch.records) as Crossed[];
  return crossed.map(({ record, witnesses, targets }, index) => {
    // A file not parsed holds its record alone: no targets, no witnesses, no parse.
    if (batch.parsed[index] !== 1) return { record, witnesses: [] };
    const encoded = batch.parses[index] ?? '';
    const read = encoded === '' ? undefined : JSON.parse(encoded) as Parsed;
    const how = batch.kept[index] === 1 ? { kept: true as const } : { parsed: true as const };
    return {
      record,
      ...(read === undefined ? {} : { read }),
      targets: (targets ?? []).map((target) => target ?? undefined),
      witnesses,
      ...how,
    };
  });
}
