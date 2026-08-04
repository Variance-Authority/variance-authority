import { readFile } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { profileById, type ProfileId, type Viewport } from '@variance-authority/core';
import type { Retention } from '@variance-authority/raster';
import { OperatorError } from './exit.js';

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
 */

/** Where the run's own report is written when the config does not say. */
export const DEFAULT_REPORT_PATH = '.variance/report.json';

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
   * Fonts this machine is asserted to have, as `family/weight/style/hash`.
   *
   * Asserted rather than detected, because a page can ask whether a family
   * resolves and cannot read the bytes behind it (spec §11.1). The four-part form
   * is enforced: a bare family name is not an identity, and a baseline keyed on
   * one compares two different cuts of Inter as though they were the same font.
   */
  readonly fonts: readonly string[];

  readonly history?: HistoryConfig;

  /** Where `run` writes, and where `report`, `accept`, and `serve` read. */
  readonly report: string;

  /** Directory for candidate images, resolved beside the report by default. */
  readonly images: string;

  /** What this run is comparing, in the operator's words. `--intent` overrides. */
  readonly intent?: string;

  readonly alone?: AloneConfig;

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
}

/**
 * How much re-collection a run will pay for to tell a regression from a leak.
 *
 * A subject that changed is re-collected in a clean world and compared again.
 * On a green run that costs nothing, because nothing changed. On a normal red
 * run it costs one collection and one render per changed subject, paid exactly
 * where it buys an attribution — the shared render is already in the render
 * cache under its document digest, so the second pass renders one image, not
 * two.
 *
 * The case that needs a limit is the one where a token moved and *everything*
 * changed. There the second pass approaches the cost of full per-subject
 * isolation, which is the regime this project exists to avoid paying. A tool
 * that gets slowest exactly when the diff is largest is a tool that gets
 * switched off on the day it mattered.
 *
 * So the budget is a cap on subjects, not a time limit: exceeding it stops the
 * pass and says so in the report, rather than silently paying or silently
 * skipping.
 */
export interface AloneConfig {
  /**
   * Subjects to re-collect, at most. Defaults to {@link DEFAULT_ALONE_LIMIT}.
   *
   * `0` turns the pass off, which is different from having no collector support:
   * one is a decision and the other is a missing capability, and the report
   * distinguishes them.
   */
  readonly limit?: number;
}

/**
 * Enough to attribute a normal regression, small enough that a token change
 * cannot turn a run into per-subject isolation.
 *
 * Not tuned — chosen. A red run with more than twenty changed subjects is
 * almost never twenty independent regressions; it is one cause with twenty
 * symptoms, and re-collecting the twenty-first says nothing the first twenty
 * did not.
 */
export const DEFAULT_ALONE_LIMIT = 20;

/**
 * Where the subject list comes from, and where the *documents* come from.
 *
 * The two halves are separate because only one of them can be generic. A story
 * index is a file with a documented shape, so this package can read it. Mounting
 * a project's components and serializing the result is not: it needs the
 * project's own bundle, its own providers, and its own idea of when a subject is
 * ready. A CLI that pretended otherwise would grow a plugin system whose failures
 * are undebuggable, so instead `collector` names a module the operator writes,
 * and the contract it must satisfy is `SubjectSource` in `commands/run.ts`.
 */
export type SubjectsConfig = StorybookSubjects | ListSubjects;

export interface StorybookSubjects {
  readonly kind: 'storybook';
  /** A built Storybook's `index.json`. Read as a file; never a running server. */
  readonly index: string;
  readonly collector: string;
  /** Stories carrying any of these tags are excluded — and reported as excluded. */
  readonly excludeTags?: readonly string[];
}

export interface ListSubjects {
  readonly kind: 'list';
  readonly ids: readonly string[];
  readonly collector: string;
}

export type BaselinesConfig = DirectoryBaselines | LfsBaselines | RemoteBaselines;

export interface DirectoryBaselines {
  readonly kind: 'directory';
  readonly root: string;
}

export interface LfsBaselines {
  readonly kind: 'lfs';
  readonly root: string;
  readonly pattern?: string;
}

export interface RemoteBaselines {
  readonly kind: 'remote';
  readonly endpoint: string;
  readonly token?: string;
}

export interface HistoryConfig {
  readonly endpoint: string;
  readonly token: string;
  /** Scopes queries. Defaults to {@link Config.project}. */
  readonly project?: string;
}

/**
 * A refusal that names the field.
 *
 * The field is a separate property and not only part of the message, so a caller
 * that wants to point at a line can, and so the message can never be assembled
 * without it. "Invalid configuration" sends the operator to read the whole file;
 * "`viewport.width` must be a positive integer" sends them to one line.
 */
export class ConfigError extends OperatorError {
  readonly field: string;

  constructor(source: string, field: string, said: string) {
    super(`${source}: \`${field}\` ${said}`);
    this.name = 'ConfigError';
    this.field = field;
  }
}

export interface ParseOptions {
  /** Named in every message. The file path, or `<stdin>`, or a test's label. */
  readonly source: string;
  /**
   * Directory relative paths are resolved against.
   *
   * The config's own directory, not the working directory. A config that means
   * something different depending on where it was invoked from is a config that
   * works locally and points at nothing in CI.
   */
  readonly baseDir: string;
}

const TOP_LEVEL = [
  'project',
  'profile',
  'viewport',
  'retention',
  'subjects',
  'baselines',
  'fonts',
  'history',
  'report',
  'images',
  'intent',
  'alone',
  'decoder',
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

  const decoder = root['decoder'] === undefined ? undefined : text(root, 'decoder', options);
  if (decoder !== undefined && decoder !== 'auto' && decoder !== 'pngjs' && decoder !== 'sharp') {
    fail('decoder', `must be "auto", "pngjs" or "sharp", not ${quote(decoder)}`, options);
  }

  return {
    project: nonEmpty(root, 'project', options),
    profile: profile as ProfileId,
    viewport: parseViewport(root['viewport'], options),
    retention,
    subjects: parseSubjects(root['subjects'], options),
    ...(baselines !== undefined ? { baselines } : {}),
    fonts: parseFonts(root['fonts'], options),
    ...(root['history'] === undefined ? {} : { history: parseHistory(root['history'], options) }),
    report,
    // Beside the *report* rather than beside the config: `ObservationRecord.images`
    // paths are relative to the report, so an image directory anchored anywhere
    // else produces links that resolve to nothing on the machine reading them.
    images: images === undefined ? resolve(dirname(report), 'images') : resolveFrom(options.baseDir, images),
    ...(intent !== undefined ? { intent } : {}),
    ...(alone !== undefined ? { alone } : {}),
    ...(decoder === undefined ? {} : { decoder: decoder as NonNullable<Config['decoder']> }),
  };
}

function parseAlone(value: unknown, options: ParseOptions): AloneConfig {
  const root = object(value, 'alone', ['limit'], options);
  if (root['limit'] === undefined) return {};

  const limit = root['limit'];
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0) {
    fail('alone.limit', `must be a non-negative integer, not ${quote(String(limit))}`, options);
  }

  return { limit: limit as number };
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

function parseViewport(value: unknown, options: ParseOptions): Viewport {
  const source = object(
    value,
    'viewport',
    ['width', 'height', 'deviceScaleFactor', 'colorScheme'],
    options,
  );

  const scale = source['deviceScaleFactor'];
  if (scale !== undefined && (typeof scale !== 'number' || !(scale > 0) || !Number.isFinite(scale))) {
    fail('viewport.deviceScaleFactor', `must be a positive number, not ${quote(scale)}`, options);
  }

  const scheme = source['colorScheme'] ?? 'light';
  if (scheme !== 'light' && scheme !== 'dark') {
    fail('viewport.colorScheme', `must be "light" or "dark", not ${quote(scheme)}`, options);
  }

  return {
    width: integer(source, 'width', 'viewport.width', options),
    height: integer(source, 'height', 'viewport.height', options),
    // 1 and light are stated defaults, and they are in the identity digest like
    // everything else — so changing them invalidates baselines visibly rather
    // than quietly repainting them at a scale nobody chose.
    deviceScaleFactor: typeof scale === 'number' ? scale : 1,
    colorScheme: scheme,
  };
}

function parseSubjects(value: unknown, options: ParseOptions): SubjectsConfig {
  const kind = kindOf(value, 'subjects', ['storybook', 'list'], options);

  if (kind === 'storybook') {
    const source = object(
      value,
      'subjects',
      ['kind', 'index', 'collector', 'excludeTags'],
      options,
    );
    const excludeTags = source['excludeTags'];
    if (excludeTags !== undefined) strings(excludeTags, 'subjects.excludeTags', options);

    return {
      kind: 'storybook',
      index: resolveFrom(options.baseDir, nonEmpty(source, 'index', options, 'subjects.index')),
      collector: resolveFrom(
        options.baseDir,
        nonEmpty(source, 'collector', options, 'subjects.collector'),
      ),
      ...(excludeTags !== undefined ? { excludeTags: excludeTags as readonly string[] } : {}),
    };
  }

  const source = object(value, 'subjects', ['kind', 'ids', 'collector'], options);
  const ids = strings(source['ids'], 'subjects.ids', options);
  if (ids.length === 0) {
    fail('subjects.ids', 'must name at least one subject; a run over nothing is not a run', options);
  }

  return {
    kind: 'list',
    ids,
    collector: resolveFrom(
      options.baseDir,
      nonEmpty(source, 'collector', options, 'subjects.collector'),
    ),
  };
}

function parseBaselines(value: unknown, options: ParseOptions): BaselinesConfig {
  const kind = kindOf(value, 'baselines', ['directory', 'lfs', 'remote'], options);

  if (kind === 'remote') {
    const source = object(value, 'baselines', ['kind', 'endpoint', 'token'], options);
    const token = optionalText(source, 'token', options, 'baselines.token');

    return {
      kind: 'remote',
      endpoint: url(source, 'endpoint', 'baselines.endpoint', options),
      ...(token !== undefined ? { token } : {}),
    };
  }

  if (kind === 'lfs') {
    const source = object(value, 'baselines', ['kind', 'root', 'pattern'], options);
    const pattern = optionalText(source, 'pattern', options, 'baselines.pattern');

    return {
      kind: 'lfs',
      root: resolveFrom(options.baseDir, nonEmpty(source, 'root', options, 'baselines.root')),
      ...(pattern !== undefined ? { pattern } : {}),
    };
  }

  const source = object(value, 'baselines', ['kind', 'root'], options);
  return {
    kind: 'directory',
    root: resolveFrom(options.baseDir, nonEmpty(source, 'root', options, 'baselines.root')),
  };
}

function parseHistory(value: unknown, options: ParseOptions): HistoryConfig {
  const source = object(value, 'history', ['endpoint', 'token', 'project'], options);
  const project = optionalText(source, 'project', options, 'history.project');

  return {
    endpoint: url(source, 'endpoint', 'history.endpoint', options),
    // Required, unlike the raster store's token: the history service refuses a
    // write it cannot attribute to an operator, so a config without one produces
    // a run that observes everything and records none of it.
    token: nonEmpty(source, 'token', options, 'history.token'),
    ...(project !== undefined ? { project } : {}),
  };
}

/**
 * Font identities, in the only form that identifies a font.
 *
 * `family/weight/style/hash`. The hash is of the bytes and is the operator's to
 * supply, because nothing observable from inside a page can produce it — a
 * renderer can be asked whether a family resolves, never whether it is the same
 * file. Accepting a bare family here would put a value in the identity digest
 * that two machines can agree on while painting differently, which is the exact
 * failure the digest exists to catch.
 */
function parseFonts(value: unknown, options: ParseOptions): readonly string[] {
  if (value === undefined) return [];
  const fonts = strings(value, 'fonts', options);

  for (const [index, font] of fonts.entries()) {
    const parts = font.split('/');
    if (parts.length !== 4 || parts.some((part) => part.trim() === '')) {
      fail(
        `fonts[${index}]`,
        `must be \`family/weight/style/hash\`, not ${quote(font)}; a family name alone does ` +
          'not identify the bytes, and two cuts of one family paint differently',
        options,
      );
    }
  }
  return fonts;
}

function resolveFrom(baseDir: string, value: string): string {
  return isAbsolute(value) ? value : resolve(baseDir, value);
}

function kindOf(
  value: unknown,
  field: string,
  known: readonly string[],
  options: ParseOptions,
): string {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(field, `must be an object, not ${quote(value)}`, options);
  }
  const kind = (value as Record<string, unknown>)['kind'];
  if (typeof kind !== 'string' || !known.includes(kind)) {
    fail(`${field}.kind`, `must be one of ${known.join(', ')}, not ${quote(kind)}`, options);
  }
  return kind;
}

function object(
  value: unknown,
  field: string,
  known: readonly string[],
  options: ParseOptions,
): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    fail(field, `must be an object, not ${quote(value)}`, options);
  }

  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (known.includes(key)) continue;
    // The field named is the *unknown* one, because that is the character the
    // operator has to delete. Reporting the parent would leave them rereading a
    // block whose every other line is correct.
    fail(
      field === 'the config' ? key : `${field}.${key}`,
      `is not a setting this tool has; it accepts ${known.join(', ')}`,
      options,
    );
  }
  return record;
}

function text(source: Record<string, unknown>, key: string, options: ParseOptions): string {
  const value = source[key];
  if (typeof value !== 'string') fail(key, `must be a string, not ${quote(value)}`, options);
  return value;
}

function nonEmpty(
  source: Record<string, unknown>,
  key: string,
  options: ParseOptions,
  field = key,
): string {
  const value = source[key];
  if (typeof value !== 'string' || value.trim() === '') {
    fail(field, `must be a non-empty string, not ${quote(value)}`, options);
  }
  return value;
}

function optionalText(
  source: Record<string, unknown>,
  key: string,
  options: ParseOptions,
  field = key,
): string | undefined {
  const value = source[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value.trim() === '') {
    fail(field, `must be a non-empty string when present, not ${quote(value)}`, options);
  }
  return value;
}

function path(
  source: Record<string, unknown>,
  key: string,
  options: ParseOptions,
): string | undefined {
  return optionalText(source, key, options);
}

function integer(
  source: Record<string, unknown>,
  key: string,
  field: string,
  options: ParseOptions,
): number {
  const value = source[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) {
    fail(field, `must be a positive integer, not ${quote(value)}`, options);
  }
  return value;
}

function url(
  source: Record<string, unknown>,
  key: string,
  field: string,
  options: ParseOptions,
): string {
  const value = nonEmpty(source, key, options, field);
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail(field, `must be an absolute URL, not ${quote(value)}`, options);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    fail(field, `must be http or https, not ${quote(parsed.protocol)}`, options);
  }
  return value;
}

function strings(value: unknown, field: string, options: ParseOptions): readonly string[] {
  if (!Array.isArray(value)) fail(field, `must be an array of strings, not ${quote(value)}`, options);

  return (value as readonly unknown[]).map((entry, index) => {
    if (typeof entry !== 'string' || entry.trim() === '') {
      fail(`${field}[${index}]`, `must be a non-empty string, not ${quote(entry)}`, options);
    }
    return entry;
  });
}

function fail(field: string, said: string, options: ParseOptions): never {
  throw new ConfigError(options.source, field, said);
}

function quote(value: unknown): string {
  if (value === undefined) return 'nothing';
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  if (typeof value === 'object') return 'an object';
  return JSON.stringify(value) ?? String(value);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
