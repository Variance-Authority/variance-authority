import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { indexSource } from '@variance-authority/core/attribute';
import type { Parsed, ParseCache } from './cache.js';
import type { Digest } from './digest.js';
import { keyFor, parseWay } from './files.js';
import { native } from './native.js';
import { readModule } from './read.js';

export interface HarvestSubject {
  readonly file: string;
  readonly digest: Digest;
}

/** Add declaration facts to selected parse-cache rows without resolving again. */
export async function enrichSources(
  root: string,
  subjects: readonly HarvestSubject[],
  cache: ParseCache,
): Promise<ReadonlyMap<string, Parsed>> {
  const files = subjects.map((subject) => subject.file);
  const found = new Map<string, Parsed>();
  const addon = native();
  if (addon !== undefined && files.length > 0) {
    const batch = addon.readBatch(root, files, undefined, false, 6);
    for (const [index, subject] of subjects.entries()) {
      const encoded = batch.parses[index];
      if (encoded === undefined || encoded === '') continue;
      const parsed = JSON.parse(encoded) as Parsed;
      found.set(subject.file, parsed);
      cache.set(keyFor(subject.digest, parseWay(subject.file)), parsed);
    }
    return found;
  }

  for (const subject of subjects) {
    const contents = await readFile(join(root, subject.file), 'utf8');
    const read = readModule(subject.file, contents);
    const way = parseWay(subject.file);
    const declares = way.declaring ? Object.keys(indexSource(subject.file, contents)).sort(byCodeUnit) : [];
    const parsed: Parsed = {
      requests: read.requests,
      ...(read.exports === undefined ? {} : { exports: read.exports }),
      ...(read.symbols === undefined ? {} : { symbols: read.symbols }),
    ...(read.mocks === undefined ? {} : { mocks: read.mocks }),
      harvested: true,
      ...(declares.length === 0 ? {} : { declares }),
      ...(read.unknown === undefined ? {} : { unknown: read.unknown }),
    };
    found.set(subject.file, parsed);
    cache.set(keyFor(subject.digest, way), parsed);
  }
  return found;
}

function byCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
