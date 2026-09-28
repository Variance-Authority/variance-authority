/** A separately refreshed corpus for public APIs of packages source imports. */

import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { readDependencyApi, type DependencyApi } from '@variance-authority/package';
import { dependenciesAround, sourceIndexPath, type ExternalOrientation } from '@variance-authority/sense';

interface Entry {
  readonly file: string;
  readonly specifier: string;
  readonly api: DependencyApi;
}

interface Corpus {
  readonly version: 2;
  readonly refreshedAt: string;
  readonly entries: readonly Entry[];
}

function pathOf(root: string): string {
  return join(dirname(sourceIndexPath(root)), 'dependency-api.json');
}

function read(path: string): Corpus | undefined {
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof value !== 'object' || value === null || (value as Partial<Corpus>).version !== 2
      || !Array.isArray((value as Partial<Corpus>).entries)) return undefined;
    return value as Corpus;
  } catch { return undefined; }
}

function key(file: string, specifier: string): string { return `${file}\0${specifier}`; }

/**
 * Refresh only requests reached from the named files. This opens the already
 * published source index; it does not rebuild it. Each installed declaration
 * graph is checked by content before a parse is reused.
 */
export function refreshDependencyApis(root: string, files: readonly string[]): {
  readonly path: string;
  readonly requests: number;
  readonly reused: number;
  readonly unavailable: number;
  readonly unread: number;
} {
  const reading = dependenciesAround(root, files, { rows: 1_000_000, names: 1_000_000 });
  if (reading.orientation === undefined) {
    throw new Error(`no source index at ${reading.index}; run \`variance index\` first`);
  }
  const incomplete = reading.orientation;
  if (incomplete.stale > 0 || incomplete.dropped > 0 || incomplete.missing.length > 0) {
    throw new Error(`dependency imports are incomplete (${incomplete.stale} changed, ${incomplete.unread} unread, ${incomplete.dropped} dropped segments, ${incomplete.missing.length} missing paths); run \`variance index\` or narrow the requested files`);
  }
  if (reading.orientation.more > 0 || reading.orientation.dependencies.some((row) => row.moreSites > 0)) {
    throw new Error('the dependency reading exceeds its bounded response; narrow the requested files');
  }
  const path = pathOf(root);
  const previous = read(path);
  const held = new Map(previous?.entries.map((entry) => [key(entry.file, entry.specifier), entry]));
  const updated = new Map<string, Entry>();
  let reused = 0;
  let unavailable = 0;
  const asked = new Set<string>();
  for (const dependency of reading.orientation.dependencies) for (const site of dependency.sites) {
    const id = key(site.file, site.specifier);
    if (asked.has(id)) continue;
    asked.add(id);
    const before = held.get(id);
    const api = readDependencyApi(root, site.file, site.specifier, before?.api);
    if (api === before?.api) reused += 1;
    if (api.unavailable !== undefined) unavailable += 1;
    updated.set(id, { file: site.file, specifier: site.specifier, api });
  }
  const entries = [...updated.values()].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 :
    a.specifier < b.specifier ? -1 : a.specifier > b.specifier ? 1 : 0);
  const corpus: Corpus = { version: 2, refreshedAt: new Date().toISOString(), entries };
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temp, JSON.stringify(corpus));
  renameSync(temp, path);
  return { path, requests: asked.size, reused, unavailable, unread: incomplete.unread };
}

export interface DependencyApiReading {
  readonly path: string;
  readonly refreshedAt?: string;
  readonly entries: readonly Entry[];
  readonly missing: readonly { readonly file: string; readonly specifier: string }[];
}

/** Join current use evidence to the separately published API corpus. */
export function dependencyApisAround(root: string, files: readonly string[], supplied?: ExternalOrientation): DependencyApiReading {
  const path = pathOf(root);
  const corpus = existsSync(path) ? read(path) : undefined;
  const held = new Map(corpus?.entries.map((entry) => [key(entry.file, entry.specifier), entry]));
  const orientation = supplied ?? dependenciesAround(root, files, { rows: 1_000_000, names: 1_000_000 }).orientation;
  const entries: Entry[] = [];
  const missing: { file: string; specifier: string }[] = [];
  const seen = new Set<string>();
  for (const dependency of orientation?.dependencies ?? []) for (const site of dependency.sites) {
    const id = key(site.file, site.specifier);
    if (seen.has(id)) continue;
    seen.add(id);
    const entry = held.get(id);
    if (entry === undefined) missing.push({ file: site.file, specifier: site.specifier });
    else entries.push(entry);
  }
  return { path, ...(corpus === undefined ? {} : { refreshedAt: corpus.refreshedAt }), entries, missing };
}
