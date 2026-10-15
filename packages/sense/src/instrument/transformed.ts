/** Probes placed on another transform's text, for regions cut from the file. */
import { instrumentationId, type InstrumentOptions, type Instrumented, type ModuleId } from './index.js';
import { placed } from './spliced.js';

/** A module whose probes another transform's text carries: {@link instrumentTransformed}. */
export interface InstrumentedTransformed extends Instrumented {
  /** The `mappings` from `code` back to the transformed text. */
  readonly mappings: string;
  /** With `carry`, `map.mappings` moved onto `code`: its sources and names as they were. */
  readonly carried?: string;
}

/**
 * Instrument one module as `instrument` does, with the probes placed in
 * `transformed`: what other transforms wrote from `source`.
 *
 * `map` is the composed map from `transformed` to its sources, `source` being
 * number `map.source` among them, and `map.file` the name `source` is read
 * under. Ordinals, names, digests and offsets are `source`'s, as `instrument`
 * cuts it. Each region of `transformed` fires the regions of `source` its code
 * came from; one only the transforms wrote fires none, and one of `source`
 * nothing vouches for fires when the module loads.
 * With `options.carry`, `carried` is `map.mappings` moved onto `code`.
 */
export function instrumentTransformed(
  source: string,
  transformed: string,
  map: { readonly file: string; readonly mappings: string; readonly source: number },
  id: ModuleId = map.file,
  options: InstrumentOptions & { readonly carry?: boolean } = {},
): InstrumentedTransformed | undefined {
  const mode = options.mode ?? 'presence';
  const answer = placed(source, transformed, map, mode, id, options.carry);
  if (answer === undefined) return undefined;
  const { code, sourceDigest, blocks, module, headerAt, mappings, carried } = answer;
  return {
    code,
    sourceDigest,
    instrumentation: instrumentationId(mode),
    blocks,
    module,
    headerAt,
    mappings,
    ...(carried === undefined ? {} : { carried }),
  };
}
