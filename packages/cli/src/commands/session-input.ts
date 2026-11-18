// compass: variance-authority.reach.crossings
/**
 * A session's V8 coverage as somebody exported it, read into the scripts
 * `sessionSources` walks: Playwright's `stopJSCoverage()` array, CDP's
 * `Profiler.takePreciseCoverage` `{ result }`, or a `NODE_V8_COVERAGE`
 * directory of `{ result, source-map-cache }` files. A script that cannot be
 * placed, read as the text that ran, or mapped is named as skipped rather than
 * read as a source of its own: a bundle read as its own source would land
 * nowhere the record cuts. Node's own modules and scripts with no URL are
 * nobody's source, and are passed over without a word.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { inlineSourceMapOf, sourceMappingUrlOf } from '@variance-authority/core/attribute';
import type { SessionMap, SessionScript, V8Function } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';

/** One script of an export, as V8 reported it: its URL, its text when the export kept it, and its functions. */
interface Reported {
  readonly url: string;
  readonly source?: string;
  readonly functions: readonly V8Function[];
}

/** What Node cached beside a script it read a map for: the map, and the length of each line of the text it ran. */
interface Cached {
  readonly data?: unknown;
  readonly lineLengths?: readonly number[];
  /** Where Node read the map: a URL, or a path relative to the script; `null` for a map inline in it. */
  readonly url?: string | null;
}

/** One file of an export: its scripts, what Node cached by script URL, and when the file was written. */
interface Exported {
  readonly result: readonly Reported[];
  readonly cache: ReadonlyMap<string, Cached>;
  readonly writtenAt: number;
}

export interface SessionInput {
  readonly scripts: readonly SessionScript[];
  /** URLs of scripts that could not be placed as a file, or whose text or map could not be read. */
  readonly skipped: readonly string[];
}

/**
 * The scripts of the export at `path`: a Playwright or CDP JSON file, or a
 * `NODE_V8_COVERAGE` directory. `served` is the directory an `http(s):`
 * script's path is read under.
 */
export async function readSession(path: string, served: string | undefined): Promise<SessionInput> {
  const scripts: SessionScript[] = [];
  const skipped: string[] = [];
  for (const exported of await exportsAt(path)) {
    for (const reported of exported.result) {
      const script = await scriptOf(reported, exported, served);
      if (script === 'nobody') continue;
      if (script === undefined) skipped.push(reported.url);
      else scripts.push(script);
    }
  }
  return { scripts, skipped };
}

async function exportsAt(path: string): Promise<readonly Exported[]> {
  const found = await stat(path).catch(() => undefined);
  if (found === undefined) throw new OperatorError(`no session at ${path}`);
  if (!found.isDirectory()) return [exportOf(path, await parsed(path), found.mtimeMs)];
  const files = (await readdir(path)).filter((file) => file.endsWith('.json')).sort();
  return Promise.all(files.map(async (file) => exportOf(join(path, file), await parsed(join(path, file)), (await stat(join(path, file))).mtimeMs)));
}

async function parsed(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new OperatorError(`${file} is not a V8 coverage export: ${(error as Error).message}`);
  }
}

function exportOf(file: string, json: unknown, writtenAt: number): Exported {
  const held = json as { result?: unknown; 'source-map-cache'?: Record<string, Cached> } | null;
  const result: unknown = Array.isArray(json) ? json : held?.result;
  if (!Array.isArray(result)) {
    throw new OperatorError(`${file} is not a V8 coverage export: neither Playwright's array nor CDP's or Node's { result }`);
  }
  if (!result.every(isReported)) throw new OperatorError(`${file} is not a V8 coverage export: a script without a url and functions with ranges`);
  return { result, cache: new Map(Object.entries((Array.isArray(json) ? undefined : held?.['source-map-cache']) ?? {})), writtenAt };
}

function isReported(each: unknown): each is Reported {
  const held = each as { url?: unknown; functions?: unknown } | null;
  return held !== null && typeof held === 'object' && typeof held.url === 'string' && Array.isArray(held.functions)
    && held.functions.every((fn: { ranges?: unknown } | null) => fn !== null && typeof fn === 'object' && Array.isArray(fn.ranges));
}

/**
 * The script `reported` names, `undefined` when it cannot be read, and `nobody`
 * for a script no source is behind. The file's last write stands for when it
 * was built, and its map's sources resolve against the file the map was read from.
 */
async function scriptOf(reported: Reported, exported: Exported, served: string | undefined): Promise<SessionScript | 'nobody' | undefined> {
  if (reported.url === '' || reported.url.startsWith('node:')) return 'nobody';
  const file = fileOf(reported.url, served);
  if (file === undefined) return undefined;
  const disk = await readFile(file, 'utf8').catch(() => undefined);
  if (disk === undefined) return undefined;
  const builtAt = (await stat(file)).mtimeMs;
  const entry = exported.cache.get(reported.url);
  // Node keeps no script text: a file written after the export, or whose lines are not the ones Node counted, holds another build, or a loader's output.
  if (reported.source === undefined && builtAt > exported.writtenAt) return undefined;
  if (reported.source === undefined && entry?.lineLengths !== undefined && !isDeepStrictEqual(lineLengths(disk), entry.lineLengths)) return undefined;
  const text = reported.source ?? disk;
  // Node's cached map first, else the one `sourceMappingURL` names.
  const found = entry?.data === undefined ? await mapOf(text, (url) => mapPlaceOf(url, reported.url, file, served)) : { map: entry.data, file: mapFileOf(entry.url, file) };
  if (found === null) return undefined;
  const script = { file, text, functions: reported.functions, builtAt };
  if (found === undefined) return script;
  if (!isMap(found.map)) return undefined;
  // A map read from disk belongs to the build on disk, which is not the one that ran when its text differs.
  if (found.file !== undefined && entry?.data === undefined && text !== disk) return undefined;
  return { ...script, map: found.map, ...(found.file === undefined ? {} : { mapFile: found.file }) };
}

/** Each line's length in UTF-16 code units, split where Node's source-map cache splits: at `\n`, U+2028 and U+2029. */
function lineLengths(text: string): readonly number[] {
  return text.split(/\n|\u2028|\u2029/).map((line) => line.length);
}

/** A path or `file:` URL is that file, and an `http(s):` one the file at its path under `served`, which only the person who ran it can name. */
function fileOf(url: string, served: string | undefined): string | undefined {
  if (url.startsWith('/')) return url;
  let parsedUrl: URL;
  try {
    parsedUrl = new URL(url);
  } catch {
    return undefined;
  }
  if (parsedUrl.protocol === 'file:') return fileURLToPath(parsedUrl);
  if ((parsedUrl.protocol === 'http:' || parsedUrl.protocol === 'https:') && served !== undefined) {
    const file = join(resolve(served), decodeURIComponent(parsedUrl.pathname));
    // A path decoded after the URL was normalised may climb out of the served directory, where no served file is.
    const under = relative(resolve(served), file);
    return under === '..' || under.startsWith(`..${sep}`) || isAbsolute(under) ? undefined : file;
  }
  return undefined;
}

/** A map, and the file it was read from when it is not inline in its script. */
interface Found {
  readonly map: unknown;
  readonly file?: string;
}

/** The map `text` names, placed by `place`: `undefined` when it names none, `null` when it names one that cannot be read. */
async function mapOf(text: string, place: (url: string) => string | undefined): Promise<Found | null | undefined> {
  const url = sourceMappingUrlOf(text);
  if (url === null) return undefined;
  const inline = inlineSourceMapOf(url);
  if (inline === null && url.startsWith('data:')) return null;
  const at = inline === null ? place(url) : undefined;
  const json = inline ?? (at === undefined ? null : await readFile(at, 'utf8').catch(() => null));
  if (json === null) return null;
  try {
    return { map: JSON.parse(json), ...(at === undefined ? {} : { file: at }) };
  } catch {
    return null;
  }
}

/** The file a map URL names: a served script's resolves against the URL it was served from, then sits under `served`; any other's beside `file`. */
function mapPlaceOf(url: string, scriptUrl: string, file: string, served: string | undefined): string | undefined {
  if (!/^https?:/.test(scriptUrl)) return mapFileOf(url, file);
  try {
    return fileOf(new URL(url, scriptUrl).href, served);
  } catch {
    return undefined;
  }
}

/** The file a map URL names beside `script`: a `file:` URL is that file, a path is relative to the script, and a `data:` URL is no file. */
function mapFileOf(url: string | null | undefined, script: string): string | undefined {
  if (typeof url !== 'string' || url.startsWith('data:')) return undefined;
  if (url.startsWith('file:')) {
    try {
      return fileURLToPath(url);
    } catch {
      return undefined;
    }
  }
  return resolve(dirname(script), decodeURIComponent(url));
}

/** A map the walk reads: one with sources and mappings. An index map, made of sections, is not one. */
function isMap(map: unknown): map is SessionMap {
  const held = map as { sources?: unknown; mappings?: unknown } | null;
  return held !== null && typeof held === 'object' && Array.isArray(held.sources) && typeof held.mappings === 'string';
}
