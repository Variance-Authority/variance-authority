import type { Viewport } from '@variance-authority/core';
import {
  fail,
  integer,
  kindOf,
  nonEmpty,
  object,
  optionalText,
  quote,
  resolveFrom,
  strings,
  url,
  type ParseOptions,
} from './config-values.js';

/**
 * The parts of a config that have a shape of their own, each with the parser that
 * builds it.
 *
 * A type and the function that constructs it belong in one file, because every
 * rule below is an argument about what its own type may contain and reading
 * either half alone leaves the reader with a field and no reason. What is
 * deliberately *not* here is the top-level `Config`: it is the sum of these, and
 * `config.ts` assembles it — which is also why that file stays the one place a
 * reader goes to find out what a run is configured by.
 */

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
 * and the contract it must satisfy is `SubjectSource` in `commands/collector.ts`.
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

export function parseAlone(value: unknown, options: ParseOptions): AloneConfig {
  const root = object(value, 'alone', ['limit'], options);
  if (root['limit'] === undefined) return {};

  const limit = root['limit'];
  if (typeof limit !== 'number' || !Number.isInteger(limit) || limit < 0) {
    fail('alone.limit', `must be a non-negative integer, not ${quote(String(limit))}`, options);
  }

  return { limit: limit as number };
}

export function parseViewport(value: unknown, options: ParseOptions): Viewport {
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

export function parseSubjects(value: unknown, options: ParseOptions): SubjectsConfig {
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

export function parseBaselines(value: unknown, options: ParseOptions): BaselinesConfig {
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

export function parseHistory(value: unknown, options: ParseOptions): HistoryConfig {
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
export function parseFonts(value: unknown, options: ParseOptions): readonly string[] {
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
