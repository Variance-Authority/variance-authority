import { gunzipSync, gzipSync } from 'node:zlib';
import {
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
 * without one says so. The shape is checked as far as the root, which is what a
 * reader can tell from a truncated or foreign record; gzip's checksum guards the
 * rest, and the format version, in the header and again inside, says the fields
 * mean what this code reads them as.
 */
export function unpackSnapshot(packed: PackedSnapshot | undefined): SemanticSnapshot | undefined {
  if (!keepsSnapshot(packed)) return undefined;

  let value: unknown;
  try {
    value = JSON.parse(gunzipSync(Buffer.from(packed!.slice(PACKED_SNAPSHOT_HEADER.length), 'base64')).toString('utf8'));
  } catch {
    return undefined;
  }

  const snapshot = value as Partial<SemanticSnapshot> | null;
  const root = snapshot?.root as Partial<SemanticSnapshot['root']> | undefined;
  if (
    snapshot?.formatVersion !== 1 ||
    typeof root !== 'object' ||
    root === null ||
    typeof root.path !== 'string' ||
    typeof root.tag !== 'string' ||
    !Array.isArray(root.children)
  ) {
    return undefined;
  }
  return value as SemanticSnapshot;
}
