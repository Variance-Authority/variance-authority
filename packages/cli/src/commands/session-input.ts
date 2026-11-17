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
import { dirname, join, resolve } from 'node:path';
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

/** One file of an export: its scripts, and what Node cached by script URL. */
interface Exported {
  readonly result: readonly Reported[];
  readonly cache: ReadonlyMap<string, Cached>;
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
      const script = await scriptOf(reported, exported.cache, served);
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
  if (!found.isDirectory()) return [exportOf(path, await parsed(path))];
  const files = (await readdir(path)).filter((file) => file.endsWith('.json')).sort();
  return Promise.all(files.map(async (file) => exportOf(join(path, file), await parsed(join(path, file)))));
}

async function parsed(file: string): Promise<unknown> {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch (error) {
    throw new OperatorError(`${file} is not a V8 coverage export: ${(error as Error).message}`);
  }
}

function exportOf(file: string, json: unknown): Exported {
  if (Array.isArray(json)) return { result: json as Reported[], cache: new Map() };
  const held = json as { result?: unknown; 'source-map-cache'?: Record<string, Cached> } | null;
  if (held === null || typeof held !== 'object' || !Array.isArray(held.result)) {
    throw new OperatorError(`${file} is not a V8 coverage export: neither Playwright's array nor CDP's or Node's { result }`);
  }
  return { result: held.result as Reported[], cache: new Map(Object.entries(held['source-map-cache'] ?? {})) };
}

/**
 * The script `reported` names, `undefined` when it cannot be read, and `nobody`
 * for a script no source is behind. A `file:` URL is that file, and an
 * `http(s):` one the file at its path under `served`, which only the person who
 * ran it can name; a URL no file answers, as another origin's does, is not
 * placed. Node keeps no script text, so the file is read only when its lines are
 * as long as the ones Node counted: a loader's transform, or a rebuild since,
 * leaves other text there, and V8's offsets would land in other functions. The
 * map is the one Node cached, else the one `sourceMappingURL` names, and its
 * sources resolve against the file it was read from. The file's last write
 * stands for when it was built.
 */
async function scriptOf(reported: Reported, cached: ReadonlyMap<string, Cached>, served: string | undefined): Promise<SessionScript | 'nobody' | undefined> {
  if (reported.url === '' || reported.url.startsWith('node:')) return 'nobody';
  const file = fileOf(reported.url, served);
  if (file === undefined) return undefined;
  const disk = await readFile(file, 'utf8').catch(() => undefined);
  if (disk === undefined) return undefined;
  const builtAt = (await stat(file)).mtimeMs;
  const entry = cached.get(reported.url);
  if (reported.source === undefined && entry?.lineLengths !== undefined && !isDeepStrictEqual(lineLengths(disk), entry.lineLengths)) return undefined;
  const text = reported.source ?? disk;
  const found = entry?.data === undefined ? await mapOf(text, file) : { map: entry.data, file: mapFileOf(entry.url, file) };
  if (found === null) return undefined;
  const script = { file, text, functions: reported.functions, builtAt };
  if (found === undefined) return script;
  if (!isMap(found.map)) return undefined;
  return { ...script, map: found.map, ...(found.file === undefined ? {} : { mapFile: found.file }) };
}

/** Each line's length in UTF-16 code units, split where Node's source-map cache splits: at `\n`, U+2028 and U+2029. */
function lineLengths(text: string): readonly number[] {
  return text.split(/\n|\u2028|\u2029/).map((line) => line.length);
}

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
    return join(resolve(served), decodeURIComponent(parsedUrl.pathname));
  }
  return undefined;
}

/** A map, and the file it was read from when it is not inline in its script. */
interface Found {
  readonly map: unknown;
  readonly file?: string;
}

/** The map `text` names: `undefined` when it names none, `null` when it names one that cannot be read. */
async function mapOf(text: string, file: string): Promise<Found | null | undefined> {
  const url = sourceMappingUrlOf(text);
  if (url === null) return undefined;
  const inline = inlineSourceMapOf(url);
  if (inline === null && url.startsWith('data:')) return null;
  const at = inline === null ? mapFileOf(url, file) : undefined;
  const json = inline ?? (at === undefined ? null : await readFile(at, 'utf8').catch(() => null));
  if (json === null) return null;
  try {
    return { map: JSON.parse(json), ...(at === undefined ? {} : { file: at }) };
  } catch {
    return null;
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
