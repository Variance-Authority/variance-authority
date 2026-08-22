import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { profileById, type ProfileId, type Viewport } from '@variance-authority/core';
import type { Retention } from '@variance-authority/raster';
import { OperatorError } from './exit.js';
import {
  ConfigError,
  fail,
  messageOf,
  nonEmpty,
  object,
  optionalText,
  path,
  quote,
  resolveFrom,
  text,
  type ParseOptions,
} from './config-values.js';
import {
  parseAlone,
  parseBaselines,
  parseFonts,
  parseHistory,
  parseRenderer,
  parseSubjects,
  parseViewport,
  type AloneConfig,
  type BaselinesConfig,
  type HistoryConfig,
  type RemoteRendererConfig,
  type SubjectsConfig,
} from './config-sections.js';
import { parseBlanks, type BlankConfig } from './config-blank.js';
import { parseSource, type ChangeConfig, type SourceConfig } from './config-source.js';
import { parseIgnores, type IgnoreConfig } from './config-ignore.js';
import { parseNames, type NamesConfig } from './config-names.js';
import { parseSensitivities, type SensitivityConfig } from './config-sensitivity.js';

export type {
  BlankConfig,
  ChangeConfig,
  IgnoreConfig,
  NamesConfig,
  SensitivityConfig,
  SourceConfig,
};
export type { AxisConfig } from './config-names.js';

/**
 * The configuration file, and the rule that nothing else configures a run.
 *
 * Every value that can move a pixel or change a verdict is written down by the
 * operator, in one file, in their repository. Nothing here is inferred from the
 * network, discovered by probing, or downloaded at run time, and that is a
 * correctness position rather than a security posture:
 *
 * - **Inference produces a config nobody wrote and nobody can review.** A tool
 *   that finds a Storybook on port 6006 works on the machine it was written on
 *   and observes a different application in CI, where 6006 is something else.
 * - **A downloaded input is an input outside the environment key.** The key
 *   (`EnvironmentInputs`) exists so that *same hash ⇒ same render*; a font, a
 *   browser, or a ruleset fetched during the run is a render input the key never
 *   saw, and the guarantee silently becomes false.
 * - **A default is a decision made by whoever wrote the tool.** Viewport and
 *   profile decide what the run can see at all (ADR-0002), so they are required
 *   rather than defaulted. A subject rendered at 1280px because nobody said
 *   otherwise is a wrong observation, and a wrong observation is worse than a
 *   missing one.
 *
 * JSON, not JavaScript. A `.js` config would mean executing code found on disk in
 * order to decide what to observe, which puts the configuration inside the thing
 * being tested. The cost is real — no comments, no computed viewport tables — and
 * is accepted.
 *
 * ## Unknown keys are refused
 *
 * A misspelled key that is ignored is the worst kind of bug this file can have:
 * the operator reads their own config, sees the setting they intended, and the
 * run does something else. Every object below is closed, and an unrecognised key
 * is refused by name alongside the ones that exist.
 *
 * ## Where the rest of it lives
 *
 * This file owns the top-level shape and nothing else. The settings that have a
 * shape of their own are in `config-sections.ts` beside the parsers that build
 * them, and the primitive checks every one of those parsers is written out of are
 * in `config-values.ts`. Both are re-exported here, so a reader or an importer
 * still meets the whole configuration at one path.
 */

/** Where the run's own report is written when the config does not say. */
export const DEFAULT_REPORT_PATH = '.variance/report.json';

export { ConfigError } from './config-values.js';
export type { ParseOptions } from './config-values.js';
export { DEFAULT_ALONE_LIMIT } from './config-sections.js';
export type {
  AloneConfig,
  BaselinesConfig,
  DirectoryBaselines,
  HistoryConfig,
  LfsBaselines,
  ListSubjects,
  RemoteBaselines,
  StorybookSubjects,
  SubjectsConfig,
} from './config-sections.js';

export interface Config {
  /**
   * Names this project in a shared history store.
   *
   * Required even with no history configured, because it is also what a later
   * `history` deployment scopes existing rows by, and rows written under a
   * project nobody chose cannot be re-attributed afterwards.
   */
  readonly project: string;

  /** Which collector, and therefore which bands can be decided at all (ADR-0002). */
  readonly profile: ProfileId;

  readonly viewport: Viewport;
  readonly retention: Retention;
  readonly subjects: SubjectsConfig;

  /** Required by, and only meaningful under, `durable` retention. */
  readonly baselines?: BaselinesConfig;

  /**
   * Directories your components are declared in, for `variance run --since`.
   *
   * Only selection reads this. Attribution's index is the collector's, built
   * where the collector already walks — this is the CLI's own copy of the same
   * question, asked before anything is collected because that is the point: a
   * subject ruled out is a subject nothing has to mount.
   *
   * Naming them is also a declaration. A changed file *inside* these is one this
   * scan understands, so a change it finds no component in forces a whole run; a
   * changed file outside them is one nobody claimed could move a render, and
   * narrowing past it is the operator's own statement of where their components
   * are ([`docs/selecting.md`](../../../docs/selecting.md)).
   */
  readonly source?: SourceConfig;

  /**
   * Fonts this machine is asserted to have, as `family/weight/style/hash`.
   *
   * Asserted rather than detected, because a page can ask whether a family
   * resolves and cannot read the bytes behind it (spec §11.1). The four-part form
   * is enforced: a bare family name is not an identity, and a baseline keyed on
   * one compares two different cuts of Inter as though they were the same font.
   */
  readonly fonts: readonly string[];

  /**
   * Which engine paints. Defaults to `chromium`.
   *
   * The one field that makes cross-browser reachable from the binary. It is a
   * single word rather than a matrix because a run has *one* identity: the
   * engine is part of the key a baseline is stored under, so two engines are two
   * runs with two sets of baselines, and a config that named both would be a
   * config describing two runs. CI shards them the way it shards anything else.
   *
   * That is also why this cannot silently change: a run that swaps `chromium` for
   * `webkit` looks for baselines under a key nothing was written to and reports
   * every subject `new` — correctly, and loudly, rather than diffing two engines
   * against each other and blaming a component for a font stack.
   */
  readonly browser?: BrowserEngine;

  /**
   * A renderer on another machine. Mutually exclusive with {@link Config.browser}.
   *
   * This is the field that makes the offload a product rather than a library
   * capability: `remote`'s argument is that the machine-bound artifact should be
   * sent to the one pinned machine instead of pinning the pipeline everywhere,
   * and until this existed `variance run` launched a local browser
   * unconditionally, so the argument was unreachable from the binary.
   */
  readonly renderer?: RemoteRendererConfig;

  readonly history?: HistoryConfig;

  /** Where `run` writes, and where `report`, `accept`, and `serve` read. */
  readonly report: string;

  /** Directory for candidate images, resolved beside the report by default. */
  readonly images: string;

  /** What this run is comparing, in the operator's words. `--intent` overrides. */
  readonly intent?: string;

  readonly alone?: AloneConfig;

  /**
   * Subtrees and difference shapes this project is not testing (spec 0024).
   *
   * The one setting on this page that makes a run *less* observant, which is why
   * it is the one with the most rules attached to it. Every entry needs an id and
   * a reason; every entry must name a selector or a fingerprint, because a rule
   * scoped only by band is a tolerance and this project does not have those; and
   * every entry is counted in the report, including when it absorbs nothing —
   * `variance run` names a rule that caught nothing as dead, because an ignore
   * that outlived its flake is a hole in the suite nobody can see.
   *
   * Outside the environment key, deliberately. Editing this changes what a run
   * says, never what it renders, so baselines survive an ignore edit. The
   * alternative would re-baseline the repository the first time somebody masked a
   * clock, which is how a safety feature becomes the thing people turn off.
   */
  readonly ignore?: readonly IgnoreConfig[];

  /**
   * Images served as nothing, at their own size, before the browser decodes them.
   *
   * What `ignore` is for a region of the page, this is for an asset — and it acts
   * one layer earlier, which is where its advantages come from. A masked hero is
   * still fetched, still lays the page out around its dimensions, and still puts
   * its bytes into the environment key, so re-exporting it re-renders every
   * subject it appears on to arrive at a difference that was going to be masked
   * anyway. A blanked one is replaced on the wire with a transparent image of the
   * *same intrinsic dimensions*, so the layout is identical and the key records
   * `blank:<rule>:<w>x<h>` instead of a digest of the discarded bytes.
   *
   * A rule matches on what a request can actually know: the URL, and the size in
   * the image's own header. `role="presentation"` is not one of those — it is a
   * fact about a document, and a request carries no idea which element wanted it
   * — so that case is the `hide-presentational-images` stabilization trick
   * instead. See `docs/stabilization.md`.
   *
   * **Inside the environment key, unlike `ignore`.** Blanking changes what is
   * rendered, not just what is reported, so a baseline taken with a rule and one
   * taken without it are two different pictures and must not be compared. The
   * key moves the day a rule is added, and the run says the identity changed
   * rather than showing a wall of red.
   */
  readonly blank?: readonly BlankConfig[];

  /**
   * How much of a subject is asserted on at all (spec 0024, ADR-0026).
   *
   * The other half of `ignore`, and the opposite sentence. An ignore says *this
   * is not the subject* — a clock, a shape that keeps moving. A sensitivity says
   * *this subject is asserted on these bands and no others*, which is what a
   * route-level test needs and what no threshold can express: a route declared
   * `layout` still reports a nav that moved by one pixel, and never reports a
   * rebrand that repainted every surface on the page.
   *
   * Decided from the component hashes a baseline carries, so a subject compared
   * against a baseline that has none is reported in full — a declaration that
   * cannot be evaluated has not been satisfied.
   *
   * Outside the environment key for the same reason `ignore` is: editing it
   * changes what a run says, never what it renders.
   */
  readonly sensitivity?: readonly SensitivityConfig[];

  /**
   * What a subject id is made of: the axes it carries, in the order it writes
   * them.
   *
   * Absent by default, and absent means the names are still read — by the
   * longest-prefix rule in `commands/variations.ts`, which needs nothing written
   * down. What a grammar adds is the reading that rule cannot reach: a spelled
   * baseline (`checkout--default`), an axis with a vocabulary (`green`,
   * `glass`), and therefore the difference between two names of the same length.
   */
  readonly names?: NamesConfig;

  /**
   * Which PNG decoder the raster tier uses.
   *
   * Decoding is 90% of a comparison (journal 0016), so this is the largest lever
   * on how long a red run takes. `auto` prefers `@variance-authority/png-sharp`
   * — libvips, 1.5× per image and up to 12× when several decode at once because
   * it runs off the event loop — and silently keeps `pngjs` when the native
   * addon is not loadable, which is the case on any platform its binaries do not
   * cover. `pngjs` pins the portable one, so a run cannot get faster or slower
   * because a machine happened to have a binary.
   *
   * Both decoders are held to producing identical RGBA, so this is a speed
   * setting and never a verdict setting.
   */
  readonly decoder?: 'auto' | 'pngjs' | 'sharp';

  /**
   * How many subjects may be in the raster tier at once. Defaults to 1.
   *
   * Only the expensive half goes wide. Collection stays strictly serial however
   * high this is set, because the collector owns one standing world (ADR-0009)
   * and mounting two subjects into one document would let each decide the
   * other's verdict. What parallelises is rendering, decoding, comparing and
   * writing — which is also where the time is, by roughly an order of magnitude
   * over collecting.
   *
   * Raising it is the operator's call because the cost is theirs. Each lane
   * holds a browser page and the decoded pixels of two images, so on a large
   * suite this is a memory decision as much as a speed one, and a two-vCPU
   * runner will not reward the same number a laptop does.
   *
   * The report does not depend on it. Observations are written in plan order no
   * matter which subject finishes first, so raising this changes what a run
   * costs and never what it says.
   */
  readonly concurrency?: number;
}

/**
 * Engines the renderer can be, listed here rather than imported.
 *
 * Importing the type from `@variance-authority/playwright` would put a browser
 * in the dependency graph of a config parser — the one file in this package that
 * must be readable, and testable, with nothing installed. The list is three words
 * and `rendererFor` fails loudly if they ever disagree.
 */
const BROWSERS = ['chromium', 'firefox', 'webkit'] as const;

export type BrowserEngine = (typeof BROWSERS)[number];

const TOP_LEVEL = [
  'project',
  'profile',
  'viewport',
  'retention',
  'subjects',
  'baselines',
  'source',
  'fonts',
  'browser',
  'renderer',
  'history',
  'report',
  'images',
  'intent',
  'alone',
  'ignore',
  'blank',
  'sensitivity',
  'names',
  'decoder',
  'concurrency',
] as const;

/**
 * Validate a parsed config value. Pure: no filesystem, no clock, no network.
 *
 * Separate from {@link loadConfig} so every rule below is testable by handing it
 * an object, which is the only reason the rules are as detailed as they are.
 */
export function parseConfig(value: unknown, options: ParseOptions): Config {
  const root = object(value, 'the config', TOP_LEVEL, options);

  const profile = text(root, 'profile', options);
  // Checked against `core`'s own table rather than a literal list here, so this
  // file cannot start rejecting a tier the rest of the system has gained. The
  // `unknown` annotation is what makes the runtime miss visible: `profileById`
  // is typed total over `ProfileId`, and this value is not one yet.
  const known: unknown = profileById(profile as ProfileId);
  if (known === undefined) {
    fail('profile', `must be a known observation profile, not ${quote(profile)}`, options);
  }

  const retention = text(root, 'retention', options);
  if (retention !== 'durable' && retention !== 'ephemeral') {
    fail('retention', `must be "durable" or "ephemeral", not ${quote(retention)}`, options);
  }

  const baselines = root['baselines'] === undefined
    ? undefined
    : parseBaselines(root['baselines'], options);

  if (retention === 'durable' && baselines === undefined) {
    fail(
      'baselines',
      'is required under "durable" retention: a durable run compares against a stored ' +
        'image, and there is nowhere to store one',
      options,
    );
  }
  if (retention === 'ephemeral' && baselines !== undefined) {
    // Refused rather than ignored. An operator who configured a baseline root and
    // sees the run succeed will believe images are being kept there; ephemeral
    // retention keeps nothing, and the two beliefs diverge silently forever.
    fail(
      'baselines',
      'is set but retention is "ephemeral", which stores nothing; remove one of the two ' +
        'so the file says what the run does',
      options,
    );
  }

  const report = resolveFrom(options.baseDir, path(root, 'report', options) ?? DEFAULT_REPORT_PATH);
  const images = path(root, 'images', options);
  const intent = optionalText(root, 'intent', options);
  const alone = root['alone'] === undefined ? undefined : parseAlone(root['alone'], options);
  const ignore = root['ignore'] === undefined ? undefined : parseIgnores(root['ignore'], options);
  const blank = root['blank'] === undefined ? undefined : parseBlanks(root['blank'], options);
  const names = root['names'] === undefined ? undefined : parseNames(root['names'], options);
  const sensitivity =
    root['sensitivity'] === undefined
      ? undefined
      : parseSensitivities(root['sensitivity'], options);

  const concurrency = root['concurrency'];
  if (
    concurrency !== undefined &&
    (typeof concurrency !== 'number' || !Number.isInteger(concurrency) || concurrency < 1)
  ) {
    fail('concurrency', `must be an integer of at least 1, not ${quote(String(concurrency))}`, options);
  }

  const browser = root['browser'] === undefined ? undefined : text(root, 'browser', options);
  if (browser !== undefined && !(BROWSERS as readonly string[]).includes(browser)) {
    fail('browser', `must be one of ${BROWSERS.join(', ')}, not ${quote(browser)}`, options);
  }

  const renderer = root['renderer'] === undefined ? undefined : parseRenderer(root['renderer'], options);
  if (renderer !== undefined && browser !== undefined) {
    // Refused rather than resolved. A config naming both asks for a local engine
    // to be selected for a render that happens on a machine this one does not
    // own, and ignoring either half is how an operator ends up certain they are
    // testing WebKit.
    fail(
      'browser',
      'cannot be set together with `renderer`: the engine belongs to whichever machine paints, ' +
        'and that machine is the remote one',
      options,
    );
  }

  const decoder = root['decoder'] === undefined ? undefined : text(root, 'decoder', options);
  if (decoder !== undefined && decoder !== 'auto' && decoder !== 'pngjs' && decoder !== 'sharp') {
    fail('decoder', `must be "auto", "pngjs" or "sharp", not ${quote(decoder)}`, options);
  }

  return {
    project: nonEmpty(root, 'project', options),
    ...(browser === undefined ? {} : { browser: browser as BrowserEngine }),
    ...(renderer === undefined ? {} : { renderer }),
    profile: profile as ProfileId,
    viewport: parseViewport(root['viewport'], options),
    retention,
    subjects: parseSubjects(root['subjects'], options),
    ...(baselines !== undefined ? { baselines } : {}),
    fonts: parseFonts(root['fonts'], options),
    ...(root['history'] === undefined ? {} : { history: parseHistory(root['history'], options) }),
    ...(root['source'] === undefined ? {} : { source: parseSource(root['source'], options) }),
    report,
    // Beside the *report* rather than beside the config: `ObservationRecord.images`
    // paths are relative to the report, so an image directory anchored anywhere
    // else produces links that resolve to nothing on the machine reading them.
    images: images === undefined ? resolve(dirname(report), 'images') : resolveFrom(options.baseDir, images),
    ...(intent !== undefined ? { intent } : {}),
    ...(alone !== undefined ? { alone } : {}),
    ...(ignore !== undefined ? { ignore } : {}),
    ...(blank !== undefined ? { blank } : {}),
    ...(sensitivity !== undefined ? { sensitivity } : {}),
    ...(names !== undefined ? { names } : {}),
    ...(decoder === undefined ? {} : { decoder: decoder as NonNullable<Config['decoder']> }),
    ...(concurrency === undefined ? {} : { concurrency: concurrency as number }),
  };
}

/**
 * Read and validate a config file.
 *
 * A missing file is an operator error with the path in it, not a fallback to
 * defaults. Running with a config that was never read is how a CI job ends up
 * observing nothing and reporting success.
 */
export async function loadConfig(path: string): Promise<Config> {
  const source = path;
  let text: string;

  try {
    text = await readFile(path, 'utf8');
  } catch (error) {
    throw new OperatorError(
      `cannot read the config file ${path}: ${messageOf(error)}. ` +
        'Nothing about a run is inferred, so there is no default to fall back to.',
      { cause: error },
    );
  }

  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new ConfigError(source, '(file)', `is not valid JSON: ${messageOf(error)}`);
  }

  return parseConfig(value, { source, baseDir: dirname(resolve(path)) });
}
