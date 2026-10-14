/** Probes placed on another transform's text, for regions cut from the file. */
import { instrumentationId, type InstrumentOptions, type Instrumented, type ModuleId } from './index.js';
import { placed } from './spliced.js';

/** A module whose probes another transform's text carries: {@link instrumentTransformed}. */
export interface InstrumentedTransformed extends Instrumented {
  /** The ordinals of `blocks` nothing in the transformed text fires. */
  readonly unplaced: readonly number[];
  /** The `mappings` from `code` back to the transformed text, when it has one. */
  readonly mappings?: string;
}

/**
 * Instrument one module as `instrument` does, with the probes placed in
 * `transformed`: what other transforms wrote from `source`.
 *
 * `map` is the composed map from `transformed` to its sources, `source` being
 * number `map.source` among them, and `map.file` the name `source` is read
 * under. Ordinals, names, digests and offsets are `source`'s, as `instrument`
 * cuts it. Each region of `transformed` fires the regions of `source` its code
 * came from; one only the transforms wrote fires none. A region of `source`
 * nothing fires is in `unplaced`, and the caller refuses the module by name.
 */
export function instrumentTransformed(
  source: string,
  transformed: string,
  map: { readonly file: string; readonly mappings: string; readonly source: number },
  id: ModuleId = map.file,
  options: InstrumentOptions = {},
): InstrumentedTransformed | undefined {
  const mode = options.mode ?? 'presence';
  const answer = placed(source, transformed, map, mode, id);
  if (answer === undefined) return undefined;
  const { code, sourceDigest, blocks, unplaced, mappings } = answer;
  return {
    code,
    sourceDigest,
    instrumentation: instrumentationId(mode),
    blocks,
    unplaced,
    ...(mappings === undefined ? {} : { mappings }),
  };
}
