/**
 * The names the published source index gives a few files' texts, read without
 * opening the rest of it.
 *
 * A reader that asks what one file's text is called needs one string per layer,
 * from the record columns retained by its native snapshot. Newest records and
 * deletions decide each asked file once; unmatched rows stay native.
 */

// compass: variance-authority.reach.source-index

import type { Digest } from '@variance-authority/core/format';
import { assertLogPath } from './immutable-log.js';
import { entry } from './help-reading.js';
import { publishedThrough, type PublishedSourcesOptions } from './published.js';
import type { SourceIndexState } from './source-index-file.js';

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
  assertLogPath(path);
  const opened = entry('openIndex')(path);
  try {
    return { path, ...opened.status(), names: new Map(opened.recordNames([...files]).map(({ file, digest }) => [file, digest as Digest])) };
  } finally { opened.close(); }
}

/**
 * The names the published generation gives `files`, under the policy {@link
 * publishedThrough} reads by: refused in CI when it is not whole, updated once
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
