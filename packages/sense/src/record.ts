/** The JavaScript oracle for turning one source file into a reusable record. */

import { readFile, stat } from 'node:fs/promises';
import { indexSource } from '@variance-authority/core/attribute';
import type { FileEdge, FileRecord, PackageEdge } from '@variance-authority/core/relate';
import type { Parsed, ParseCache } from './cache.js';
import { digestString, type Digest } from './digest.js';
import { keyFor, languageFor, parseWay, type ParseWay } from './files.js';
import { readJava, readKotlin } from './jvm.js';
import { indexesComponents, type LanguageId } from './language.js';
import { readPython } from './python.js';
import { native } from './native.js';
import { readModule, type Read } from './read.js';
import { readStyle } from './style.js';
import { resolveAll, type Resolvers } from './resolve.js';
import { isRelative, kindFor, packageOf, requestOf } from './specifier.js';
import { readRust } from './rust.js';
import { readSwift } from './swift.js';
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
  readonly targets?: readonly (string | undefined)[];
  /** What the bytes said, absent when the file could not be read. */
  readonly read?: Parsed;
}

/** Read, parse and resolve one file through the implementation of record. */
export async function recordFor(subject: RecordSubject): Promise<BuiltRecord> {
  const { absolute, file, root, resolvers, cache, largestFile } = subject;
  const way = parseWay(file);
  const language = languageFor(way);

  // No reader claims this name. That is not the same as a file with no edges,
  // and saying so is the whole rule this package is built on: a repository
  // whose files nobody read must not read as a repository with nothing in it.
  if (language === undefined) {
    return {
      record: {
        file,
        unknown: `${file} is written in a language this build has no reader for, so what it asks for is unknown.`,
      },
      witnesses: [],
    };
  }

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
    read = parsedFrom(file, contents, way, language);
    cache.set(keyFor(digest, way), read);
  }

  const edges: FileEdge[] = [];
  const packages: PackageEdge[] = [];
  const unresolved: string[] = [];
  const holes: string[] = [];
  const targets: (string | undefined)[] = [];

  for (const asked of read.requests) {
    const request = requestOf(asked.value);
    if (request === undefined) {
      targets.push(undefined);
      continue;
    }

    // Every file the specifier reaches, which for Java, Kotlin and Swift is a
    // whole package or a whole target. `targets` stays one entry per request —
    // the source index is keyed by that alignment — and carries the first,
    // while every one of them becomes an edge.
    const reached = resolveAll({ resolvers, root, from: absolute, request, language });
    const target = reached[0];
    targets.push(target);
    if (target === undefined) {
      // A guess that lands is an edge; a guess that does not is silence. The
      // reader derived it precisely because the language would not say whether
      // it names anything ([`read.ts`](./read.ts)), so its absence is an answer
      // and not a gap — recording it as unresolved would report every Python
      // package in the tree as depending on modules nobody ever wrote.
      if (asked.guessed === true) continue;
      unresolved.push(asked.value);

      // A bare specifier that does not resolve is a package, and the scan has no
      // business finding *where* it went: under pnpm's store or Yarn PnP there
      // may be no path, and under a custom resolver the path would be a fact
      // about one machine. The name is the node, and the lockfile says what is
      // currently under it ([`lock`](./lock/index.ts)).
      const named = packageOf(request);
      if (named !== undefined) packages.push({ to: named, kind: asked.kind });

      // A *relative* one names a path inside this repository and could not be
      // identified, which is a hole in the edge list rather than an absence of
      // one — so the file is marked unknown with the specifier named, and the
      // edge is left to the recorded run.
      if (isRelative(request, language)) holes.push(asked.value);
      continue;
    }
    for (const to of reached) edges.push({ to, kind: kindFor(asked.kind, to) });
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
      ...(packages.length === 0 ? {} : { packages: dedupe(packages) }),
      ...(read.declares === undefined ? {} : { declares: read.declares }),
      ...(unresolved.length === 0
        ? {}
        : { unresolved: [...new Set(unresolved)].sort(byCodeUnit) }),
      ...(reasons.length === 0 ? {} : { unknown: `${file} — ${reasons.join('; ')}` }),
    },
    read,
    targets,
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
function parsedFrom(file: string, contents: string, way: ParseWay, language: LanguageId): Parsed {
  const read = readerFor(language)(file, contents);
  const declares = way.declaring && indexesComponents(language)
    ? Object.keys(indexSource(file, contents))
    : [];
  return {
    requests: read.requests,
    ...(read.exports === undefined ? {} : { exports: read.exports }),
    ...(read.symbols === undefined ? {} : { symbols: read.symbols }),
    harvested: true,
    ...(declares.length === 0 ? {} : { declares: declares.sort(byCodeUnit) }),
    ...(read.unknown === undefined ? {} : { unknown: read.unknown }),
  };
}

/** The reader each language is read by. Every one of them answers the same shape. */
function readerFor(language: LanguageId): (file: string, contents: string) => Read {
  switch (language) {
    case 'style': return readStyle;
    case 'python': return accelerated('python', readPython);
    case 'rust': return accelerated('rust', readRust);
    case 'java': return accelerated('java', readJava);
    case 'kotlin': return accelerated('kotlin', readKotlin);
    case 'swift': return accelerated('swift', readSwift);
    default: return readModule;
  }
}

/**
 * The same reader, run natively when a binary reached this machine.
 *
 * The tree-sitter languages are read by a grammar linked into the addon rather
 * than a WebAssembly build walked node by node from JavaScript, which is what
 * [ADR-0065](../../../docs/context/adr/0065-source-scanning-is-one-native-side.md)
 * asks of every reader: the walk happens where the tree is, and what crosses the
 * boundary is the answer. The JavaScript reader stays and stays the oracle — it
 * is what runs without a toolchain, and what the native answer is compared
 * against.
 *
 * A native answer that does not arrive is the JavaScript one, taken without
 * comment. An acceleration is allowed to disappear and never to change the graph.
 */
function accelerated(
  language: LanguageId,
  oracle: (file: string, contents: string) => Read,
): (file: string, contents: string) => Read {
  return (file, contents) => {
    const addon = native();
    if (addon?.readLanguage === undefined) return oracle(file, contents);
    try {
      const answer = addon.readLanguage(language, file, contents);
      if (answer !== null) return JSON.parse(answer) as Read;
    } catch {
      // Left to the oracle below, which is the implementation of record.
    }
    return oracle(file, contents);
  };
}

function dedupe<Edge extends FileEdge>(edges: readonly Edge[]): readonly Edge[] {
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
