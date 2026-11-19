/**
 * The names the published source index gives a few files' texts, read without
 * opening the rest of it.
 *
 * A reader that asks what one file's text is called needs one string per file,
 * and a whole read ({@link readPublishedSources}) offers every parse and every
 * record. This opens the chain as a whole read does and asks it the asked files'
 * records alone, so both say the same thing about the same files.
 */

// compass: variance-authority.reach.source-index

import type { Digest } from '@variance-authority/core/format';
import { BadLogPath, openImmutableLog, type ImmutableLog } from './immutable-log.js';
import { publishedThrough, type PublishedSourcesOptions } from './published.js';
import type { SourceIndexState } from './source-index-file.js';
import { readSourceIndexChain } from './source-index-reader.js';

/** The names one published generation gives the asked files' texts. */
export interface PublishedNames {
  /** The index file that was read. */
  readonly path: string;
  /** Whether it was whole, absent, or readable only up to a bad segment or one of another format version. */
  readonly state: SourceIndexState;
  /** The format version the unread segment names, when `state` is `other-version`. */
  readonly written?: number;
  /** Each asked file the index holds a text name for, with that name; a file it holds none for is not here. */
  readonly names: ReadonlyMap<string, Digest>;
}

/** The names the generation at `path` gives `files`. Reads the index and nothing else. */
export async function readPublishedNames(path: string, files: Iterable<string>): Promise<PublishedNames> {
  const asked = new Set(files);
  let log: ImmutableLog;
  try {
    log = await openImmutableLog(path);
  } catch (error) {
    // A manifest that does not read is a damaged chain, as a whole read has it;
    // a path that cannot name a file is a caller's defect.
    if (error instanceof BadLogPath) throw error;
    return { path, state: 'damaged', names: new Map() };
  }
  // The chain is cut where a whole read cuts it, and only the asked files' rows
  // are decoded.
  const { kept: read, written, stored } = readSourceIndexChain(log.segments);
  const kept = log.keep(read);
  const names = new Map<string, Digest>();
  for (const file of asked) {
    const digest = stored.records.get(file)?.record.digest;
    if (digest !== undefined) names.set(file, digest);
  }
  return {
    path,
    state: !kept.committed ? 'missing' : kept.damaged === 0 ? 'published' : written === undefined ? 'damaged' : 'other-version',
    ...(written === undefined ? {} : { written }),
    names,
  };
}

/**
 * The names the published generation gives `files`, under the policy {@link
 * publishedSources} reads by: refused in CI when it is not whole, updated once
 * elsewhere, then read.
 */
export async function publishedNames(
  root: string,
  files: Iterable<string>,
  options: PublishedSourcesOptions,
): Promise<PublishedNames> {
  const asked = [...files];
  return publishedThrough(root, options, (path) => readPublishedNames(path, asked));
}
