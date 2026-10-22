/**
 * What a test process loads through Node itself rather than through a runner's
 * transform, and the probes placed on it.
 *
 * `registerRecording` instruments a runner that has no transform of its own,
 * deciding each file in the process that loads it.
 *
 * CommonJS, so a setup module can reach it with `createRequire` from a worker
 * with no resolution root, as it reaches `collectors.cts`.
 */

import nodeModule = require('node:module');
import url = require('node:url');

type ModuleHooks = nodeModule.ModuleHooks;

/** The formats Node evaluates from source text; `json`, `wasm`, `builtin` and `addon` are not. */
const EVALUATED = new Set(['module', 'commonjs', 'module-typescript', 'commonjs-typescript']);

/**
 * Hook every module Node loads from a file and evaluates as source, and
 * evaluate what `place` answers for it in its place; `undefined` leaves it as
 * it loaded. `text` is read only when asked, and TypeScript arrives as written,
 * for Node to strip after.
 */
function hookLoads(place: (file: string, text: () => string) => string | undefined): ModuleHooks {
  return nodeModule.registerHooks({
    load(at, context, nextLoad) {
      const loaded = nextLoad(at, context);
      if (!at.startsWith('file:') || loaded.source === undefined || loaded.source === null) return loaded;
      if (!EVALUATED.has(loaded.format ?? '')) return loaded;
      const source = loaded.source;
      const placed = place(url.fileURLToPath(at), () => textOf(source));
      return placed === undefined ? loaded : { ...loaded, source: placed };
    },
  });
}

/** A loaded module's source as text, however the loader handed it over. */
function textOf(source: string | ArrayBuffer | NodeJS.TypedArray): string {
  return typeof source === 'string' ? source : new TextDecoder().decode(source);
}

export = { hookLoads };
