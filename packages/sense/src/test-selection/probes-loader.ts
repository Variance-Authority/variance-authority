/**
 * The probes of a build Rspack or webpack bundles, as a loader; the rule that
 * runs it is [`testSelectionRule`](./probes-rule.ts).
 *
 * Asked for the collector, it answers with the collector's source. Asked for
 * any other module, it places the probes in what the loaders before it wrote,
 * through the map they handed on ([`loader-probes.ts`](./loader-probes.ts)),
 * and opens the module with the collector — an `import`, or a `require` in a
 * script such as CommonJS — on its first line so no line moves, the map's first
 * line moved with it. A module it does not probe
 * passes untouched. With `placement: 'before-transforms'` it runs ahead of
 * the loaders and places the probes in the text it is handed, as read.
 */

import type { InstrumentMode } from '../instrument/index.js';
import { cleanId, defaultInclude } from './instrumented-modules.js';
import { placeModule, type Captured } from './captured-modules.js';
import { probeHanded, type HandedMap } from './loader-probes.js';
import { shifted } from './map-segments.js';
import { executionCollectorSource } from './probes.js';
import { COLLECTOR_FILE, PROBES_LOADER, includeOf, type ProbesLoaderOptions } from './probes-rule.js';
import { repositoryRoot } from './repository-root.js';

/** The subset of the Rspack and webpack loader surface this uses, so nothing here needs either. */
export interface ProbesLoaderContext {
  /** The file on disk, without a bundler's query suffix. */
  readonly resourcePath: string;
  /** The project's directory, which a rule with no `root` names the checkout from. */
  readonly rootContext?: string;
  readonly getOptions: () => ProbesLoaderOptions & { readonly collector?: string };
  readonly callback: (error: Error | null, code?: string, map?: HandedMap) => void;
}

/**
 * Webpack and Rspack ask for source maps where `devtool` names one; a loader
 * that rewrites the file and hands on no map breaks the chain too.
 */
const REMEDY = 'Have `devtool` write source maps and every loader ahead of the probes hand its map on';

function probesLoader(this: ProbesLoaderContext, code: string, handed?: HandedMap): void {
  const options = this.getOptions();
  let written: { code: string; map?: HandedMap };
  try {
    written = options.collector === undefined ? probed(this, options, code, handed) : { code: executionCollectorSource(recipe(options.collector)) };
  } catch (error) {
    this.callback(error as Error);
    return;
  }
  this.callback(null, written.code, written.map);
}

/** `code` probed, opened with the collector, and the map moved with it; as handed where it is not a module to probe. */
function probed(context: ProbesLoaderContext, options: ProbesLoaderOptions, code: string, handed: HandedMap): { code: string; map?: HandedMap } {
  const file = cleanId(context.resourcePath);
  const root = repositoryRoot(options.root ?? context.rootContext ?? process.cwd());
  const include = options.include === undefined ? defaultInclude : includeOf(options.include);
  // Ahead of the loaders, every line is where the file has it: the handed map, if any, still holds.
  const placed = options.placement === 'before-transforms'
    ? ahead(placeModule(root, file, code, include, undefined, options.mode), handed)
    : probeHanded(file, code, handed, { root, include, mode: options.mode, remedy: REMEDY });
  if (placed === undefined) return { code, map: handed };
  // `!!`: the collector goes through this loader alone, never the project's.
  const collector = JSON.stringify(`!!${PROBES_LOADER}?collector=${options.mode ?? 'presence'}!${COLLECTOR_FILE}`);
  // An `import` would make a script a module, and its `module.exports` unread;
  // an `.mjs` file is a module whatever it holds, and has no `require`.
  const opening = placed.captured.script && !/\.m[jt]s$/.test(file) ? `require(${collector});` : `import ${collector};`;
  const map = placed.map && { ...placed.map, mappings: shifted(placed.map.mappings, opening.length) };
  return { code: `${opening}${placed.captured.code}`, map };
}

/** What {@link placeModule} placed ahead of the loaders, with the map it was handed. */
function ahead(captured: Captured | undefined, handed: HandedMap) {
  if (captured === undefined) return undefined;
  const map = (typeof handed === 'string' ? JSON.parse(handed) : (handed ?? undefined)) as Exclude<HandedMap, string | null> | undefined;
  return { captured, map };
}

function recipe(mode: string): InstrumentMode {
  if (mode === 'presence' || mode === 'entries') return mode;
  throw new Error(`variance-authority: the probes loader was asked for a collector of recipe ${JSON.stringify(mode)}, which is none.`);
}

// Named here and exported as the default, because a loader is named by path:
// the rule spells the file, never the function.
export { probesLoader as default };
