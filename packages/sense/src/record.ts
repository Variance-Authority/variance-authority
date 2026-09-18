/** The JavaScript oracle for turning one source file into a reusable record. */

import { readFile, stat } from 'node:fs/promises';
import { indexSource } from '@variance-authority/core/attribute';
import type { FileEdge, FileRecord } from '@variance-authority/core/relate';
import type { Parsed, ParseCache } from './cache.js';
import { digestString, type Digest } from './digest.js';
import { isStyle, keyFor, parseWay, type ParseWay } from './files.js';
import { readModule, readStyle } from './read.js';
import {
  isRelative,
  kindFor,
  requestOf,
  resolveTo,
  type Resolvers,
} from './resolve.js';
import { witnessesOf, type Aliases } from './witness.js';

export interface RecordSubject {
  readonly absolute: string;
  readonly file: string;
  readonly root: string;
  readonly resolvers: Resolvers;
  readonly cache: ParseCache;
  /** Where a bare specifier could land, when the tree bounds it. */
  readonly aliases: Aliases | undefined;
  /** Every directory the tree holds, which bounds where a lookup can land. */
  readonly directories: ReadonlyMap<string, Digest>;
  /** The largest file to open, in bytes. */
  readonly largestFile: number;
  /** Whether the record cache will consume directory witnesses. */
  readonly remembering: boolean;
  /** This file's content digest, when it was known without opening the file. */
  readonly digest?: Digest;
}

export interface BuiltRecord {
  readonly record: FileRecord;
  readonly witnesses: readonly string[];
  /** What the bytes said, absent when the file could not be read. */
  readonly read?: Parsed;
}

/** Read, parse and resolve one file through the implementation of record. */
export async function recordFor(subject: RecordSubject): Promise<BuiltRecord> {
  const { absolute, file, root, resolvers, cache, largestFile } = subject;
  const way = parseWay(file);
  const style = isStyle(way);

  // A digest from git names a cache entry before the file is opened; only a
  // miss falls through to I/O.
  let digest = subject.digest;
  let read = digest === undefined ? undefined : cache.get(keyFor(digest, way));

  if (read === undefined) {
    const size = await sized(absolute);
    if (size !== undefined && size > largestFile) {
      return {
        record: {
          file,
          unknown:
            `${file} is ${size} bytes, over the ${largestFile} this scan opens: ` +
            'parsing it costs about fifty times that in memory, and it is almost ' +
            'certainly built output. Raise `largestFile` to read it anyway.',
        },
        witnesses: [],
      };
    }

    let contents: string;
    try {
      contents = await readFile(absolute, 'utf8');
    } catch (error) {
      return {
        record: { file, unknown: `${file} could not be read: ${messageOf(error)}` },
        witnesses: [],
      };
    }

    digest ??= digestString(contents);
    read = parsedFrom(file, contents, way, style);
    cache.set(keyFor(digest, way), read);
  }

  const edges: FileEdge[] = [];
  const unresolved: string[] = [];
  const holes: string[] = [];

  for (const asked of read.requests) {
    const request = requestOf(asked.value);
    if (request === undefined) continue;

    const target = resolveTo({ resolvers, root, from: absolute, request, style });
    if (target === undefined) {
      unresolved.push(asked.value);
      if (isRelative(request)) holes.push(asked.value);
      continue;
    }
    edges.push({ to: target, kind: kindFor(asked.kind, target) });
  }

  const reasons = [
    ...(read.unknown === undefined ? [] : [read.unknown]),
    ...(holes.length === 0
      ? []
      : [`${holes.length} relative specifier(s) that resolve to nothing: ${holes.join(', ')}`]),
  ];

  return {
    record: {
      file,
      ...(digest === undefined ? {} : { digest }),
      ...(edges.length === 0 ? {} : { edges: dedupe(edges) }),
      ...(read.declares === undefined ? {} : { declares: read.declares }),
      ...(unresolved.length === 0
        ? {}
        : { unresolved: [...new Set(unresolved)].sort(byCodeUnit) }),
      ...(reasons.length === 0 ? {} : { unknown: `${file} — ${reasons.join('; ')}` }),
    },
    read,
    witnesses: subject.remembering
      ? witnessesOf({
        file,
        requests: read.requests.map((asked) => asked.value),
        edges: edges.map((edge) => edge.to),
        directories: subject.directories,
        aliases: subject.aliases,
      })
      : [],
  };
}

async function sized(absolute: string): Promise<number | undefined> {
  try {
    return (await stat(absolute)).size;
  } catch {
    return undefined;
  }
}

/** Everything one file's bytes say before anything about where it sits. */
function parsedFrom(file: string, contents: string, way: ParseWay, style: boolean): Parsed {
  const read = style ? readStyle(file, contents) : readModule(file, contents);
  const declares = style || !way.declaring ? [] : Object.keys(indexSource(file, contents));
  return {
    requests: read.requests,
    ...(read.exports === undefined ? {} : { exports: read.exports }),
    ...(declares.length === 0 ? {} : { declares: declares.sort(byCodeUnit) }),
    ...(read.unknown === undefined ? {} : { unknown: read.unknown }),
  };
}

function dedupe(edges: readonly FileEdge[]): readonly FileEdge[] {
  const seen = new Set<string>();
  return edges
    .filter((edge) => {
      const key = `${edge.kind} ${edge.to}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => byCodeUnit(a.to, b.to) || byCodeUnit(a.kind, b.kind));
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
