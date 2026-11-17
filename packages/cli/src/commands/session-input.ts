// compass: variance-authority.reach.crossings
/**
 * A session's V8 coverage as somebody exported it, read into the scripts
 * `sessionSources` walks.
 *
 * Three exports carry the same per-script report: Playwright's
 * `stopJSCoverage()` writes an array of scripts, each with the text it ran;
 * CDP's `Profiler.takePreciseCoverage` writes `{ result }`; and a
 * `NODE_V8_COVERAGE` directory holds one `{ result, source-map-cache }` file per
 * process, the maps Node read beside its scripts. A script is placed as a file
 * on this machine by its URL: a `file:` URL is that file, and an `http(s):` one
 * is the file at its path under the directory the page was served from, which
 * only the person who ran it can name. Its map is the one Node cached, else the
 * one its `sourceMappingURL` names, inline or beside it. A script that cannot be
 * placed, or whose map cannot be read, is named as skipped rather than read as a
 * source of its own: a bundle read as its own source would land nowhere the
 * record cuts. Node's own modules and scripts with no URL are nobody's source,
 * and are passed over without a word.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineSourceMapOf, sourceMappingUrlOf } from '@variance-authority/core/attribute';
import type { SessionMap, SessionScript, V8Function } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';

/** One script of an export, as V8 reported it: its URL, its text when the export kept it, and its functions. */
interface Reported {
  readonly url: string;
  readonly source?: string;
  readonly functions: readonly V8Function[];
}

/** One file of an export: its scripts, and the maps Node cached by script URL. */
interface Exported {
  readonly result: readonly Reported[];
  readonly maps: ReadonlyMap<string, unknown>;
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
      const script = await scriptOf(reported, exported.maps, served);
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
  if (Array.isArray(json)) return { result: json as Reported[], maps: new Map() };
  const held = json as { result?: unknown; 'source-map-cache'?: Record<string, { data?: unknown }> } | null;
  if (held === null || typeof held !== 'object' || !Array.isArray(held.result)) {
    throw new OperatorError(`${file} is not a V8 coverage export: neither Playwright's array nor CDP's or Node's { result }`);
  }
  const cache = Object.entries(held['source-map-cache'] ?? {});
  return { result: held.result as Reported[], maps: new Map(cache.map(([url, entry]) => [url, entry.data])) };
}

/** The script `reported` names, `undefined` when it cannot be read, and `nobody` for a script no source is behind. */
async function scriptOf(reported: Reported, cached: ReadonlyMap<string, unknown>, served: string | undefined): Promise<SessionScript | 'nobody' | undefined> {
  if (reported.url === '' || reported.url.startsWith('node:')) return 'nobody';
  const file = fileOf(reported.url, served);
  if (file === undefined) return undefined;
  const text = reported.source ?? (await readFile(file, 'utf8').catch(() => undefined));
  if (text === undefined) return undefined;
  const map = cached.get(reported.url) ?? (await mapOf(text, file));
  if (map === null) return undefined;
  if (map !== undefined && !isMap(map)) return undefined;
  return { file, text, functions: reported.functions, ...(map === undefined ? {} : { map }) };
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

/** The map `text` names: `undefined` when it names none, `null` when it names one that cannot be read. */
async function mapOf(text: string, file: string): Promise<unknown> {
  const url = sourceMappingUrlOf(text);
  if (url === null) return undefined;
  const inline = inlineSourceMapOf(url);
  const json = inline ?? (url.startsWith('data:') ? null : await readFile(resolve(dirname(file), decodeURIComponent(url)), 'utf8').catch(() => null));
  if (json === null) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

/** A map the walk reads: one with sources and mappings. An index map, made of sections, is not one. */
function isMap(map: unknown): map is SessionMap {
  const held = map as { sources?: unknown; mappings?: unknown } | null;
  return held !== null && typeof held === 'object' && Array.isArray(held.sources) && typeof held.mappings === 'string';
}
