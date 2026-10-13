import { gunzipSync, gzipSync } from 'node:zlib';
import {
  isSemanticSnapshot,
  keepsSnapshot,
  PACKED_SNAPSHOT_HEADER,
  type PackedSnapshot,
  type SemanticSnapshot,
} from '@variance-authority/core/format';

/**
 * The snapshot a raster keeps, packed for the sidecar.
 *
 * Here rather than in `@variance-authority/raster`, which owns the sidecar,
 * because that package is read inside a Worker that has no `node:zlib`, and it
 * never needs to look inside: every store carries the text as it is. The two
 * ends are the run that takes a snapshot and the run that decides with one, and
 * both of them are this package or call it.
 */
export function packSnapshot(snapshot: SemanticSnapshot): PackedSnapshot {
  return PACKED_SNAPSHOT_HEADER + gzipSync(JSON.stringify(snapshot)).toString('base64');
}

/**
 * The snapshot a raster kept, or `undefined` when it kept none it can read.
 *
 * Unreadable is *not recorded*, the same answer as absent: the snapshot decides
 * which boxes a region is joined against, and the sentence of a verdict joined
 * without one says so. Its shape is checked to the leaves by
 * `isSemanticSnapshot`, the check a capture file's snapshot meets too, because
 * the matcher walks every node and gzip's checksum vouches only that the text
 * is what was packed, not that what was packed was a snapshot.
 */
export function unpackSnapshot(packed: PackedSnapshot | undefined): SemanticSnapshot | undefined {
  if (!keepsSnapshot(packed)) return undefined;

  let value: unknown;
  try {
    value = JSON.parse(gunzipSync(Buffer.from(packed!.slice(PACKED_SNAPSHOT_HEADER.length), 'base64')).toString('utf8'));
  } catch {
    return undefined;
  }

  return isSemanticSnapshot(value) ? value : undefined;
}
