/**
 * What a reader said about a file, keyed by the file's bytes and the reader.
 *
 * A reader is handed a file's text and answers with an {@link ImportDiff}. That
 * answer is a pure function of two things and nothing else: the bytes, and the
 * reader asking. So it is cacheable the way a parse is — forever, by content
 * digest — as long as the key carries both halves. A key that carried only the
 * digest would hand one taint's answer to another taint about the same file,
 * and a key that carried only the reader would be a guess about freshness.
 *
 * A taint's *name* is its identity: two taints with one name are one taint
 * twice ({@link Taint.name}), which is the contract that makes the name usable
 * as half of a cache key.
 *
 * ## Why it lives in the parse cache
 *
 * The entries go in the {@link ParseCache} the scan already opened, under a
 * digest taken over the file's digest, the reader's name and which side of the
 * diff is stored. Each entry is a list of specifiers, which is what a parse
 * entry holds; what the parse cache offers on top of a map — a content key that
 * never goes stale, and pruning that drops what no branch references any more —
 * is exactly what this wants, and a second store beside it would have to
 * reimplement both.
 *
 * The two sides are two entries rather than one, so that neither has to be
 * written into a field that means something else.
 *
 * ## The reader is its code, not only its name
 *
 * A name says which reader; it does not say which revision of it. The mock
 * reader shipped reading `jest.requireActual` only inside a factory, and a
 * cache keyed by the name alone would go on answering with that reading for
 * every unchanged test file after the reader learned to read it anywhere. So
 * the key also carries the version of this package, which ships the readers
 * that are part of it: an upgrade re-reads the files a reader opens, once.
 */

// compass: variance-authority.reach

import type { EdgeKind } from '@variance-authority/core/relate';
import type { ParseCache, Parsed } from '../cache.js';
import { createRequire } from 'node:module';
import { digestString, type Digest } from '../digest.js';
import type { ImportDiff } from './index.js';

/** The reader's answer for these bytes, or nothing when it was never asked. */
export function rememberedDiff(
  cache: ParseCache | undefined,
  digest: Digest | undefined,
  name: string,
): ImportDiff | undefined {
  if (cache === undefined || digest === undefined) return undefined;
  const minus = cache.get(keyFor(digest, name, '-'));
  const plus = cache.get(keyFor(digest, name, '+'));
  // Half an answer is no answer: a chain that lost one segment holds one side
  // of a diff, and half a diff is a shadow without its additions.
  if (minus === undefined || plus === undefined) return undefined;

  return { minus: specifiersOf(minus), plus: specifiersOf(plus) };
}

/** Write down what the reader said, for every run over these bytes after this one. */
export function rememberDiff(
  cache: ParseCache | undefined,
  digest: Digest | undefined,
  name: string,
  diff: ImportDiff | undefined,
): void {
  if (cache === undefined || digest === undefined) return;
  cache.set(keyFor(digest, name, '-'), entryOf(diff?.minus));
  cache.set(keyFor(digest, name, '+'), entryOf(diff?.plus));
}

const { version: REVISION } = createRequire(import.meta.url)('../../package.json') as { version: string };

function keyFor(digest: Digest, name: string, side: '-' | '+'): Digest {
  return digestString(`taint\u0000${REVISION}\u0000${digest}\u0000${name}\u0000${side}`);
}

function specifiersOf(parsed: Parsed): readonly string[] {
  return parsed.requests.map((request) => request.value);
}

function entryOf(values: readonly string[] | undefined): Parsed {
  const kind: EdgeKind = 'imports';

  // Line 0, and it is not a position. What this carries is a *set of specifiers*
  // a taint added or removed, stored in the shape the parse cache already knows
  // how to encode; no statement in any file wrote them, so there is no line to
  // report and 0 is outside the 1-based range a real one occupies.
  return { requests: (values ?? []).map((value) => ({ value, kind, bindings: [], line: 0 })) };
}
