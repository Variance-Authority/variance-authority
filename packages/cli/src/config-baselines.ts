import { DEFAULT_BASELINE_PATH, parseBaselinePath, type BaselinePathTemplate } from '@variance-authority/store/durable';
import { baselineCarrierOf } from './config-placement.js';
import {
  fail,
  kindOf,
  nonEmpty,
  object,
  optionalText,
  quote,
  resolveFrom,
  secret,
  url,
  type ParseOptions,
} from './config-values.js';

/**
 * Where baselines live — the one axis with no default and no inferred answer.
 *
 * Three placements, chosen in [`placement.md`](https://variance-authority.dev/docs/placement), and
 * the choice is the operator's because the three fail in different directions
 * and none of them is safe to guess: `directory` and `lfs` are committed, and a
 * repository that ignores them reports every subject `new` forever without ever
 * erroring; `remote` is not committed, and a run that cannot reach it must stop.
 * Nothing here reads a verdict differently
 * ([ADR-0016](https://github.com/Variance-Authority/variance-authority/blob/main/docs/context/adr/0016-where-a-baseline-is-kept-decides-nothing.md)).
 */
export type BaselinesConfig = DirectoryBaselines | LfsBaselines | RemoteBaselines;

export interface DirectoryBaselines {
  readonly kind: 'directory';
  readonly root: string;
  /**
   * The path a baseline is written at under `root`, as a template without an
   * extension: `{title}/{name}-{engine}` when absent. `{dir}` and `{file}` put
   * it beside the file that declares the subject. Validated here, so a template
   * that could place two subjects on one path, or one outside the root, stops
   * the config and never a run halfway through writing.
   */
  readonly path?: string;
  /**
   * Where the `.json` records go, if not beside the images.
   *
   * The one key here that answers *what does version control see*. A record
   * changes whenever the document does — a class name, a build id, a font that
   * resolved to something else — so records beside their images make a diff out
   * of every edit, including the ones that moved no pixel. Pointed at an ignored
   * directory or a CI cache, `root` holds images and nothing else.
   *
   * Not inferred, and deliberately not: a record that is not there costs the run
   * its `missingFonts` and its inspected regions, which a verdict is allowed to
   * turn on. An operator who moves them is choosing to keep them somewhere.
   */
  readonly records?: string;
  /**
   * Who carries the directory to the next job: `actions-cache` or nobody. `lfs`
   * and `remote` take none, because git and the service already carry them.
   */
  readonly carry?: 'actions-cache';
}

export interface LfsBaselines {
  readonly kind: 'lfs';
  readonly root: string;
  readonly pattern?: string;
  /** See {@link DirectoryBaselines.path}. */
  readonly path?: string;
  /** See {@link DirectoryBaselines.records}. */
  readonly records?: string;
}

export interface RemoteBaselines {
  readonly kind: 'remote';
  readonly endpoint: string;
  readonly token?: string;
}

export function parseBaselines(value: unknown, options: ParseOptions): BaselinesConfig {
  const kind = kindOf(value, 'baselines', ['directory', 'lfs', 'remote'], options);

  if (kind === 'remote') {
    const source = object(value, 'baselines', ['kind', 'endpoint', 'token'], options);
    // Optional, and read through `secret` when it is there: the store that needs
    // one is somebody's deployment, so the value belongs in the environment even
    // though the decision to send it belongs here.
    const token =
      source['token'] === undefined ? undefined : secret(source, 'token', options, 'baselines.token');

    return {
      kind: 'remote',
      endpoint: url(source, 'endpoint', 'baselines.endpoint', options),
      ...(token !== undefined ? { token } : {}),
    };
  }

  refuseLayout(value, options);

  if (kind === 'lfs') {
    const source = object(
      value,
      'baselines',
      ['kind', 'root', 'pattern', 'path', 'records'],
      options,
    );
    const pattern = optionalText(source, 'pattern', options, 'baselines.pattern');
    const path = parsePath(source['path'], options);
    const records = parseRecords(source['records'], options);
    const root = resolveFrom(options.baseDir, nonEmpty(source, 'root', options, 'baselines.root'));
    if (pattern === undefined) {
      // The `.gitattributes` entry is the template's glob: unanchored at the
      // top of the repository, LFS would take each hyphenated icon, fixture and
      // screenshot that is not a baseline.
      refuseUnanchored(root, path, 'its LFS pattern would track', '; or set baselines.pattern yourself', options);
    }

    return {
      kind: 'lfs',
      root,
      ...(pattern !== undefined ? { pattern } : {}),
      ...(path !== undefined ? { path } : {}),
      ...(records !== undefined ? { records } : {}),
    };
  }

  const source = object(value, 'baselines', ['kind', 'root', 'path', 'records', 'carry'], options);
  const path = parsePath(source['path'], options);
  const records = parseRecords(source['records'], options);
  const carry = baselineCarrierOf(source['carry'], options);
  if (carry !== undefined && path?.includes('{dir}') === true) {
    // The cache carries the root, and a template that places by `{dir}` makes
    // the root the repository: every source file would ride in the cache.
    fail(
      'baselines.carry',
      `cannot carry baselines that baselines.path ${quote(path)} places beside the code with {dir}: ` +
        'the cache carries the whole root, and that root holds the code too. Commit them, or drop {dir}',
      options,
    );
  }
  const root = resolveFrom(options.baseDir, nonEmpty(source, 'root', options, 'baselines.root'));
  // The commit-back stages what the template's glob fits, and a held-baseline
  // sweep reads it: unanchored at the top of the repository, both take every
  // image whose name happens to fit.
  refuseUnanchored(root, path, 'a commit-back would stage', '', options);
  return {
    kind: 'directory',
    root,
    ...(path !== undefined ? { path } : {}),
    ...(records !== undefined ? { records } : {}),
    ...(carry !== undefined ? { carry } : {}),
  };
}

/**
 * A template with no directory of its own, under a root that is the top of the
 * repository: its glob fits images that are not baselines, and whatever reads
 * the glob — LFS, a commit-back, a sweep — takes them too.
 */
function refuseUnanchored(
  root: string,
  path: string | undefined,
  consequence: string,
  remedy: string,
  options: ParseOptions,
): void {
  if (root !== resolveFrom(options.baseDir, '.') || parseBaselinePath(path ?? DEFAULT_BASELINE_PATH).anchored) return;
  fail(
    'baselines.path',
    `${quote(path ?? DEFAULT_BASELINE_PATH)} names no directory of its own, so under a root of "." ${consequence} ` +
      'every image in the repository whose name it fits, not only baselines. ' +
      'Give it one, e.g. "{dir}/__baselines__/{file}/{name}-{engine}" or "__baselines__/{title}/{name}-{engine}"; ' +
      `or give baselines a root of their own${remedy}`,
    options,
  );
}

/**
 * The `layout` key `path` replaced, refused with the `path` that keeps each
 * layout's place, so the upgrade is a copy rather than a reading of the docs.
 * Rename without aliases: the old key is not read, only named.
 */
function refuseLayout(value: unknown, options: ParseOptions): void {
  if (typeof value !== 'object' || value === null || !('layout' in value)) return;
  fail(
    'baselines.layout',
    'is replaced by baselines.path. "beside" is "path": "{dir}/__baselines__/{file}/{name}-{engine}"; ' +
      `"flat" is the default path, "${DEFAULT_BASELINE_PATH}". A baseline already kept under either layout ` +
      'is still found, and moves to the new path on its next accept',
    options,
  );
}

/**
 * The record directory, resolved like the root it is an alternative to.
 *
 * Relative to the config file rather than the process, for the same reason
 * `root` is: the two are read together by a person deciding what their
 * repository tracks, and a pair of paths that resolve against different things
 * is a pair somebody gets wrong once.
 */
function parseRecords(value: unknown, options: ParseOptions): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value === '') {
    fail('baselines.records', `must be a directory path, not ${quote(value)}`, options);
  }
  return resolveFrom(options.baseDir, value as string);
}

function parsePath(value: unknown, options: ParseOptions): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    fail('baselines.path', `must be a path template, not ${quote(value)}`, options);
  }
  let template: BaselinePathTemplate | undefined;
  try {
    template = parseBaselinePath(value as string);
  } catch (error) {
    // The store names the field itself, for a caller that builds one in code;
    // here the field is already the first thing the message says.
    const said = error instanceof Error ? error.message : String(error);
    fail('baselines.path', said.replace(/^baselines\.path /, ''), options);
  }
  if (template?.hasProject === true) {
    // Projects are Playwright's, and Playwright reads its path from the
    // fixture's own options: no subject this config collects carries one.
    fail('baselines.path', `${quote(value)} places by {project}, and no suite this config runs has projects`, options);
  }
  return value as string;
}
