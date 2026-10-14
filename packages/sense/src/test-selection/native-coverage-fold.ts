import { native, nativeRefusal } from '../native.js';
/** Fold named coverage shards directly over stored columns, refusing conflicting observations. */
export function foldCoverageArtifacts(files: readonly string[]): {
  readonly bytes: Buffer; readonly tests: number; readonly modules: number;
} {
  const scanner = native();
  if (scanner?.foldCoverageArtifacts === undefined) throw new Error(`coverage shard folding requires the current native addon: ${nativeRefusal()}`);
  return scanner.foldCoverageArtifacts([...files]);
}
