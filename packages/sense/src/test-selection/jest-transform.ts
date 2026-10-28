/**
 * The Jest transformer: the project's own transform, then probes on what it wrote.
 *
 * Named in a configuration by the Jest wrappers, and loaded by Jest once per
 * worker. It wraps whatever transformer the configuration named — `@swc/jest`,
 * `ts-jest`, `babel-jest`, anything with Jest's transformer shape — and never
 * chooses one: the project's transformer runs on the file as Jest read it, with
 * the project's options, and the probes of that file's regions go into what it
 * wrote, through the map it returned ({@link probedAfter}). A test file is cut
 * first instead, and the transformer runs on the cut. A transformer that changes
 * the text and returns no map is run again on the probed text, since nothing
 * carries the regions into what it wrote.
 *
 * Jest's transform cache decides what it costs: the text this returns is
 * stored on disk under `getCacheKey`, shared by every worker and every later
 * run, and a module whose content and configuration have not changed is never
 * handed to `process` again — so the parse `instrument` does is paid once per
 * content version per machine, not once per worker or per run. Nothing about
 * what the probes mean is written: the reporter cuts the module again from the
 * file and the digest its probes report.
 *
 * A module the instrumenter cannot read, and one `unprobed` names, leaves the
 * inner transformer with one mark after its last line.
 *
 * A transformer that places the probes itself — a Rust pipeline linking the
 * instrumenter crate the package ships — says so with `senseRecipe`, and is
 * then handed each module untouched, with {@link SenseProbes} saying where its
 * probes go. A module `unprobed` names is marked here and handed over without
 * them, since the mark is not a probe the crate places. A module it hands back
 * with no probe in it, which is what the crate leaves of one it cannot parse,
 * is marked after the transform.
 */

import { markFaultRead, readFaulted, runFault } from './fault.js';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  globMatcher,
  isTestFile,
  jestCacheKey,
  loadTransformer,
  slashed,
  type JestTestFiles,
  type JestTransformer as JestShapedTransformer,
  type JestTransformOptions,
} from './jest-transformer.js';
import { cadence, type CutTestFile } from '../instrument/cadence.js';
import { behindCut, inlineBehindCut } from './cut-map.js';
import { probeRecipe, type InstrumentMode, type ModuleId } from '../instrument/index.js';
import { probesRegions } from '../instrument/identity.js';
import { markUnplaced, placeModule, planModule } from './captured-modules.js';
import { defaultInclude, projectPath, type ProbePlacement } from './instrumented-modules.js';
import { probedAfter } from './jest-after.js';
import type { SelectionTransformerConfig } from './jest.js';
import { namesItsMap, type TransformSourceMap } from './source-lines.js';

/** The fields of Jest's project configuration this reads. */
export interface JestProjectConfig extends JestTestFiles {
  readonly cacheDirectory: string;
  /** Jest's own hash of this project's configuration: which build made this text. */
  readonly id?: string;
}

/** The fields of Jest's `TransformOptions` this reads. */
export interface JestTransformRequest extends JestTransformOptions {
  readonly config: JestProjectConfig;
  /** What a transformer with a `senseRecipe` places in this module; absent places nothing. */
  readonly senseProbes?: SenseProbes;
}

/**
 * Where one module's probes go, handed to a transformer that places them: the
 * arguments of `instrument` in the instrumenter crate.
 */
export interface SenseProbes {
  /** The project path the module is parsed as: only its extension is read. */
  readonly file: string;
  /** The id the probes report. */
  readonly module: ModuleId;
  readonly mode: InstrumentMode;
}

export interface JestTransformedSource {
  readonly code: string;
  readonly map?: string | TransformSourceMap | null;
}

/** The shape of a transformer as Jest loads one, sync or async. */
export interface JestTransformer extends JestShapedTransformer<JestTransformRequest, JestTransformedSource> {
  /**
   * The recipe this transformer places sense's probes with under `mode`, from
   * the instrumenter crate's `recipe`. A transformer that has one is handed
   * {@link SenseProbes} instead of a text that carries them, and one whose
   * recipe is not this package's is refused before it transforms anything.
   */
  senseRecipe?(mode: InstrumentMode): string;
}

/**
 * Build the transformer Jest will call, wrapping whichever one the configuration
 * named.
 *
 * Async because a transformer module may be ES, and Jest awaits this factory
 * for exactly that reason. The inner transformer is resolved from the project
 * root rather than from this package: `@swc/jest` is the adopter's dependency,
 * and resolving it from here would find this package's copy or none.
 *
 * `process` is offered only when the wrapped transformer has one. Jest takes the
 * synchronous path for every CommonJS module, and a wrapper that answered it by
 * blocking on an asynchronous inner transform would be a wrapper that hangs.
 * `canInstrument` is the inner transformer's own: one that instruments for
 * `--coverage` itself still does, and the probes land on top.
 */
export async function createTransformer(
  config: SelectionTransformerConfig,
): Promise<JestTransformer> {
  const root = resolve(config.root);
  const inner = config.transformer === undefined
    ? undefined
    : await loadTransformer<JestTransformRequest, JestTransformedSource, JestTransformer>(root, config.transformer);
  const mode = config.mode ?? 'presence';
  const recipe = probeRecipe(mode);
  // Under `loads` nothing is placed, so a transformer that places probes is not asked to.
  const theirs = !probesRegions(mode) ? undefined : inner?.transformer.senseRecipe?.(mode);
  const places = theirs !== undefined;
  if (places && theirs !== recipe) {
    throw new Error(
      `${inner?.name} places sense's probes as ${theirs}, and this sense reads ${recipe}: ` +
        'build it against node_modules/@variance-authority/sense/native/instrument',
    );
  }
  const excluded = new Set((config.exclude ?? []).map((file) => resolve(file)));
  const how: Placing = { mode, excluded, unprobed: unprobedMatcher(config.unprobed), placement: config.placement ?? 'after-transforms' };
  const cuts = config.cadence !== false && probesRegions(mode);
  const cutOf = (source: string, path: string, options: JestTransformRequest): CutTestFile | undefined =>
    cuts && isTestFile(path, options.config) ? cadence(source, path) : undefined;
  // The project's transformer maps the cut text, so its map is moved back to
  // the file on disk: Jest writes an inline snapshot into the call a frame
  // names, by line and column, and refuses a file whose calls it cannot find.
  // A transformer that returns no map, `@swc/jest` among them, leaves it inline.
  const behind = (transformed: JestTransformedSource, cut: CutTestFile | undefined): JestTransformedSource => {
    if (cut === undefined) return transformed;
    if (transformed.map == null || transformed.map === '') {
      return { ...transformed, code: inlineBehindCut(transformed.code, cut.shifts) };
    }
    return { ...transformed, map: behindCut(transformed.map, cut.shifts) };
  };
  const keyOf = (path: string, innerKey: string): string =>
    createHash('sha1')
      .update(recipe)
      .update('\0')
      .update(innerKey)
      .update('\0')
      .update(path)
      .update('\0')
      .update(JSON.stringify(inner?.options ?? null))
      .update('\0')
      .update(excluded.has(resolve(path)) ? 'excluded' : '')
      .update('\0')
      .update(JSON.stringify(config.unprobed ?? null))
      .update('\0')
      .update(cuts ? 'cadence' : '')
      .update('\0')
      .update(how.placement)
      .update('\0')
      .update(faultKey(path))
      .digest('hex')
      .slice(0, 32);
  // A transformer that rewrote a module and returned no map leaves nothing to
  // carry the regions into what it wrote, so it runs again on the probed text:
  // said once, because every module it transforms pays for it. A file that
  // names its own map, a build's output, is not said: a transformer that reads
  // that map answers in the build's sources, as it should, and its file is
  // probed first, as every seam that composes from that map probes it.
  let warned = false;
  const mapless = <T>(path: string, source: string, again: () => T): T => {
    if (!warned && !namesItsMap(source)) {
      warned = true;
      const name = inner?.name ?? 'the transformer';
      console.warn(
        `variance-authority: \`${name}\` returned no source map back to \`${projectPath(root, path)}\`, so the probes cannot ` +
          'be placed in what it wrote, and it transforms each such module twice: once to read, once on the probed file. ' +
          'A compiler that reads syntax, such as a CSS-in-JS extractor or a memoising compiler, then reads the probes too. ' +
          `Have \`${name}\` return a source map to transform once, with the probes out of its reading.`,
      );
    }
    return again();
  };
  // A fault skips its region in the file as Jest read it, so every step after
  // this one takes the skipped text as the file; its key is the file's alone.
  const fault = runFault();
  const skips = (path: string): boolean => fault?.file === projectPath(root, path);
  const read = (source: string, path: string): string => skips(path) ? readFaulted(fault!.file, source, undefined, fault).code : source;
  // Jest keys a file whether or not its cache holds the transform, so the key
  // is where a run served the skipped text from that cache marks it read.
  const faultKey = (path: string): string => {
    if (!skips(path)) return '';
    markFaultRead(fault!);
    return String(fault!.ordinal);
  };
  const innerProcessAsync = inner?.processAsync;

  const transformer: JestTransformer = {
    canInstrument: inner?.canInstrument ?? false,
    getCacheKey: (source, path, options) =>
      keyOf(path, inner?.cacheKey(source, path, options) ?? jestCacheKey(source, path, options)),
    getCacheKeyAsync: async (source, path, options) =>
      keyOf(path, (await inner?.cacheKeyAsync(source, path, options)) ?? jestCacheKey(source, path, options)),
    processAsync: async (disk, path, options) => {
      const source = read(disk, path);
      const cut = cutOf(source, path, options);
      const text = cut?.code ?? source;
      if (innerProcessAsync === undefined) return bare(root, path, options, text, how, cut);
      const handed = places ? handOver(root, path, options, text, how) : undefined;
      if (handed !== undefined) return behind(marked(await innerProcessAsync(text, path, handed), handed), cut);
      const first = async () => await innerProcessAsync(place(root, path, options, text, how), path, options);
      if (places || !after(path, options, how)) return behind(await first(), cut);
      return probedAfter(root, path, source, await innerProcessAsync(text, path, options), how.mode, how.unprobed) ?? mapless(path, source, first);
    },
  };
  const innerProcess = inner?.process;
  if (inner === undefined || innerProcess !== undefined) {
    transformer.process = (disk, path, options) => {
      const source = read(disk, path);
      const cut = cutOf(source, path, options);
      const text = cut?.code ?? source;
      if (innerProcess === undefined) return bare(root, path, options, text, how, cut);
      const handed = places ? handOver(root, path, options, text, how) : undefined;
      if (handed !== undefined) return behind(marked(innerProcess(text, path, handed), handed), cut);
      const first = () => innerProcess(place(root, path, options, text, how), path, options);
      if (places || !after(path, options, how)) return behind(first(), cut);
      return probedAfter(root, path, source, innerProcess(text, path, options), how.mode, how.unprobed) ?? mapless(path, source, first);
    };
  }
  return transformer;
}

/** What decides where a module's probes go, the same for every module of one transformer. */
interface Placing {
  readonly mode: InstrumentMode;
  readonly excluded: ReadonlySet<string>;
  readonly unprobed: ((file: string) => boolean) | undefined;
  readonly placement: ProbePlacement;
}

/** What no wrapped transformer touches: the probes, or the cut and its map. */
function bare(
  root: string,
  path: string,
  options: JestTransformRequest,
  text: string,
  how: Placing,
  cut: CutTestFile | undefined,
): JestTransformedSource {
  const code = place(root, path, options, text, how);
  return cut === undefined ? { code } : { code, map: JSON.stringify(cut.map) };
}

/**
 * Probes on the project's text.
 *
 * A test file is not a module: nothing enters one, and its own edit is what
 * runs it. It is cut instead, before this, unless `cadence` is off. Which
 * files are tests is the project's `testMatch` or `testRegex`, read from the
 * configuration Jest hands every transform, matched the way Jest's own search
 * matches them.
 *
 * Every probe is placed on the line it reports, so the wrapped transformer's
 * map names the right line of the project's source for a stack trace.
 */
function place(
  root: string,
  path: string,
  options: JestTransformRequest,
  source: string,
  { mode, excluded, unprobed }: Placing,
): string {
  if (!probes(path, options, { excluded })) return source;
  return placeModule(root, path, source, defaultInclude, unprobed, mode, originalOf(path, source))?.code ?? source;
}

/**
 * Whether a module's probes go into what the inner transformer wrote: every
 * one that gets probes, unless the run places them `before-transforms`. A file that names its own map, a build's output, is
 * placed after too wherever its transformer's map leads back to it, as
 * `babel-jest` does reading no map from a file beside it; one that composed
 * the build's map answers in the build's sources, and is probed first.
 */
function after(path: string, options: JestTransformRequest, how: Placing): boolean {
  return how.placement === 'after-transforms' && probes(path, options, how);
}

/** Whether a module gets probes, rather than a cut or nothing: neither excluded nor a test. */
function probes(path: string, options: JestTransformRequest, { excluded }: Pick<Placing, 'excluded'>): boolean {
  return !excluded.has(resolve(path)) && !isTestFile(path, options.config);
}

/**
 * The same decisions as {@link place}, handed to a transformer that places the
 * probes itself; `undefined` for a module {@link place} marks, which that
 * transformer is handed already marked.
 */
function handOver(
  root: string,
  path: string,
  options: JestTransformRequest,
  source: string,
  { mode, excluded, unprobed }: Placing,
): JestTransformRequest | undefined {
  if (excluded.has(resolve(path)) || isTestFile(path, options.config)) return options;
  const plan = planModule(root, path, source, defaultInclude, originalOf(path, source), unprobed);
  if (plan === undefined) return options;
  return plan.marked ? undefined : { ...options, senseProbes: { file: plan.file, module: plan.id, mode } };
}

/** What a transformer that places the probes made of a module it was handed probes for, marked when it placed none. */
function marked(done: JestTransformedSource, handed: JestTransformRequest): JestTransformedSource {
  const id = handed.senseProbes?.module;
  return id === undefined ? done : { ...done, code: markUnplaced(done.code, id) };
}

/** The file as Jest read it is the text it handed over; any other is read from disk. */
function originalOf(path: string, source: string): (at: string) => string {
  return (at) => (at === path ? source : readFileSync(at, 'utf8'));
}

/**
 * The `unprobed` globs as one predicate over absolute paths, read as Jest reads
 * `testMatch` ({@link globMatcher}). The wrapper resolved each with
 * `path.resolve`, which spells a Windows path with backslashes, so each is
 * slashed first, as Jest slashes the paths it matches.
 */
function unprobedMatcher(globs: readonly string[] | undefined): ((file: string) => boolean) | undefined {
  return globs === undefined || globs.length === 0 ? undefined : globMatcher(globs.map(slashed));
}

// Jest unwraps `default` when a host loader transpiles this module to CommonJS
// with `__esModule`. Keep the named factory for callers that import it directly.
export default { createTransformer };
