/** Source reads shared by taint analysis, and size checks for reusable records. */

import { readFileSync, statSync } from 'node:fs';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';
import type { FileRecord } from '@variance-authority/core/relate';
import type { Parsed, ParseCache } from './cache.js';
import { digestString } from './digest.js';
import type { Digest } from '@variance-authority/core/format';
import { keyFor, languageFor, parseWay, type ParseWay } from './files.js';
import { readModule } from './read.js';

/** A module's cached native read for taint analysis, under the current size limit. */
export function parsedOnce(input: {
  readonly root: string;
  readonly file: string;
  readonly cache?: ParseCache;
  readonly digest?: Digest | undefined;
  readonly largestFile?: number;
  /** Told of each parse made here, where it is made, and of the bytes it parsed. */
  readonly counted?: (file: string, contents: string) => void;
}): Parsed | undefined {
  const { root, file, cache, largestFile } = input;
  const way = parseWay(file);
  if (languageFor(way) !== 'module') return undefined;
  const held = input.digest === undefined ? undefined : cache?.get(keyFor(input.digest, way));
  let contents: string;
  if (held !== undefined) return largestFile === undefined || heldUnder(held, join(root, file), largestFile) ? held : undefined;
  try {
    if (largestFile !== undefined && statSync(join(root, file)).size > largestFile) return undefined;
    contents = readFileSync(join(root, file), 'utf8');
  } catch {
    return undefined;
  }
  const key = keyFor(input.digest ?? digestString(contents), way);
  let read = cache?.get(key);
  if (read === undefined) {
    read = parsedFrom(file, contents, way);
    input.counted?.(file, contents);
  }
  cache?.set(key, read);
  return read;
}

/**
 * Whether a held parse answers under `largestFile`, which is not the limit that
 * read it: by the size it was measured at, else by the file's as checked out.
 * A size neither knows, such as a stylesheet's absent from a sparse checkout,
 * answers nothing, so the file is read again and says why it could not be.
 * `read_kept` in `batch.rs` keeps the same rule for the addon.
 */
function heldUnder(held: Parsed, absolute: string, largestFile: number): boolean {
  let bytes = held.size?.bytes;
  if (bytes === undefined) {
    try {
      bytes = statSync(absolute).size;
    } catch {
      return false;
    }
  }
  return bytes <= largestFile;
}

/** The rest of the reason a file declined for its size is given: `too_large` in `acquire.rs` writes the same words. */
const TOO_LARGE =
  'this scan opens: parsing it costs about fifty times that in memory, and it is ' +
  'almost certainly built output. Raise `largestFile` to read it anyway.';

/** Whether `record` was declined for its size. */
// TODO: a record carries a decline for size only in its reason's words; a field
// for it would let a keep ask without matching them.
export function declinedForSize(record: FileRecord): boolean {
  const { file, unknown } = record;
  return unknown !== undefined && unknown.startsWith(`${file} is `) && unknown.endsWith(TOO_LARGE);
}

/**
 * Whether the file at `absolute` is still over `largestFile` as it is checked
 * out, through any link. A decline is decided on these bytes and kept by Git's
 * object name, which under a clean filter — `core.autocrlf`, LFS — names others.
 */
export async function stillTooLarge(absolute: string, largestFile: number): Promise<boolean> {
  const size = await sized(absolute);
  return size !== undefined && size > largestFile;
}

async function sized(absolute: string): Promise<number | undefined> {
  try {
    return (await stat(absolute)).size;
  } catch {
    return undefined;
  }
}

/**
 * Everything one file's bytes say before anything about where it sits.
 *
 * The components a file declares are the module reader's answer, read off the
 * tree the native batch reads them off ([`declarations.rs`](../native/src/declarations.rs)),
 * so a module reaches the same record whichever path built it.
 */
function parsedFrom(file: string, contents: string, way: ParseWay): Parsed {
  const read = readModule(file, contents);
  const declares = way.declaring ? read.declares ?? [] : [];
  return {
    requests: read.requests,
    ...(read.exports === undefined ? {} : { exports: read.exports }),
    ...(read.symbols === undefined ? {} : { symbols: read.symbols }),
    ...(read.mocks === undefined ? {} : { mocks: read.mocks }),
    ...(read.harvested === true ? { harvested: true } : {}),
    ...(declares.length === 0 ? {} : { declares }),
    ...(read.ownUses === undefined ? {} : { ownUses: read.ownUses }),
    ...(read.bindingMembers === undefined ? {} : { bindingMembers: read.bindingMembers }),
    ...(read.unknown === undefined ? {} : { unknown: read.unknown }),
    ...(read.size === undefined ? {} : { size: read.size }),
  };
}
