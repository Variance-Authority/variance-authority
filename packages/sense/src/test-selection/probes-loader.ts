/**
 * The probes of a build Rspack or webpack bundles, as a loader; the rule that
 * runs it is [`testSelectionRule`](./probes-rule.ts).
 *
 * Asked for the collector, it answers with the collector's source. Asked for
 * any other module, it places the probes in what the loaders before it wrote,
 * through the map they handed on ([`loader-probes.ts`](./loader-probes.ts)),
 * and takes the collector without moving a line: a module ends with an
 * `import`, which is hoisted, and a script such as CommonJS takes a `require`
 * past its directive prologue, the map's columns moved with it. Either way a
 * `"use client"` or `"use strict"` stays first. A module it marks as loaded,
 * one the instrumenter cannot parse, takes the collector between the text the
 * loaders wrote and the mark, as an `import` or a `require` by what that text
 * is. A module it does not probe passes untouched. With `placement: 'before-transforms'` it runs ahead of
 * the loaders and places the probes in the text it is handed, as read.
 */

import { instrument, type InstrumentMode } from '../instrument/index.js';
import { cleanId, defaultInclude } from './instrumented-modules.js';
import { MapRefusal, placeModule, type Captured } from './captured-modules.js';
import { handedMap, probeHanded, type HandedMap } from './loader-probes.js';
import { shifted } from './map-segments.js';
import { executionCollectorSource } from './probes.js';
import { COLLECTOR_FILE, PROBES_LOADER, type ProbesLoaderOptions } from './probes-rule.js';
import { repositoryRoot } from './repository-root.js';

/** The subset of the Rspack and webpack loader surface this uses, so nothing here needs either. */
export interface ProbesLoaderContext {
  /** The file on disk, without a bundler's query suffix. */
  readonly resourcePath: string;
  /** The project's directory, which a rule with no `root` names the checkout from. */
  readonly rootContext?: string;
  readonly getOptions: () => ProbesLoaderOptions & { readonly collector?: string };
  /** The configured loader paths, in the order the bundler lists them. */
  readonly loaders?: readonly { readonly path: string }[];
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
    if (error instanceof MapRefusal && this.loaders !== undefined && this.loaders.length > 0) {
      error.message += '\nLoader chain as listed by the bundler:\n' + this.loaders.map((loader) => `  ${loader.path}`).join('\n');
    }
    this.callback(error as Error);
    return;
  }
  this.callback(null, written.code, written.map);
}

/** `code` probed, taking the collector, and the map moved with it; as handed where it is not a module to probe. */
function probed(context: ProbesLoaderContext, options: ProbesLoaderOptions, code: string, handed: HandedMap): { code: string; map?: HandedMap } {
  const file = cleanId(context.resourcePath);
  const root = repositoryRoot(options.root ?? context.rootContext ?? process.cwd());
  // The rule asked the project's `include` before handing the file over, and
  // the function stays in that process: a built file's sources, which the
  // rule never saw, are taken because the rule took the built file.
  const include = options.include === 'rule' ? everything : defaultInclude;
  // Ahead of the loaders, every line is where the file has it: the handed map, if any, still holds.
  const placed = options.placement === 'before-transforms'
    ? ahead(placeModule(root, file, code, include, undefined, options.mode), handed)
    : probeHanded(file, code, handed, { root, include, mode: options.mode, remedy: REMEDY });
  if (placed === undefined) return { code, map: handed };
  // `!!`: the collector goes through this loader alone, never the project's.
  const collector = JSON.stringify(`!!${PROBES_LOADER}?collector=${options.mode ?? 'presence'}!${COLLECTOR_FILE}`);
  const text = placed.captured.code;
  const required = `require(${collector});`;
  // An `import` would make a script a module, and its `module.exports` unread;
  // an `.mjs` file is a module whatever it holds, and has no `require`.
  if (/\.m[jt]s$/.test(file)) return { code: `${text}\n;import ${collector};`, map: placed.map };
  // A module marked rather than probed carries its mark after the text the
  // loaders wrote: the collector goes between them, on a line of its own, so
  // it runs before the mark and no column moves. Whether that text is a
  // script is asked of the text itself; one the instrumenter cannot parse
  // takes the `require`, which Rspack and webpack read in a module too.
  // The asking costs one parse of the loaders' text, for a marked module alone:
  // an `unprobed` module and a variant reach here unparsed, so no earlier read
  // holds the answer.
  if (!placed.captured.module.instrumented) {
    const taken = instrument(code, file)?.module === true ? `\n;import ${collector};` : `\n;${required}`;
    return { code: `${code}${taken}${text.slice(code.length)}`, map: placed.map };
  }
  const script = placed.captured.script;
  if (script === undefined) return { code: `${text}\n;import ${collector};`, map: placed.map };
  const line = text.slice(0, script.at).split('\n').length - 1;
  const column = script.at - (text.lastIndexOf('\n', script.at - 1) + 1);
  const map = placed.map && { ...placed.map, mappings: shifted(placed.map.mappings, required.length, line, column) };
  return { code: `${text.slice(0, script.at)}${required}${text.slice(script.at)}`, map };
}

/** The `include` of a rule whose own condition already chose the file. */
function everything(): boolean {
  return true;
}

/** What {@link placeModule} placed ahead of the loaders, with the map it was handed. */
function ahead(captured: Captured | undefined, handed: HandedMap) {
  return captured === undefined ? undefined : { captured, map: handedMap(handed) };
}

function recipe(mode: string): InstrumentMode {
  if (mode === 'presence' || mode === 'entries' || mode === 'loads') return mode;
  throw new Error(`variance-authority: the probes loader was asked for a collector of recipe ${JSON.stringify(mode)}, which is none.`);
}

// Named here and exported as the default, because a loader is named by path:
// the rule spells the file, never the function.
export { probesLoader as default };
