// compass: variance-authority/runtime/attention
/**
 * The review as `review.json` spells it, and back.
 *
 * A change that moves most of a suite enters most regions with most cases, so
 * a review that writes every case under every region it entered weighs
 * regions × cases: hundreds of megabytes, past the longest string V8 holds.
 * `review.json` writes each case once, in `cases`, and a region names the
 * cases that entered it by their place in that list. The places are the
 * cases' order by test file, title and id, so a review over the same cases
 * gives each the same place; a reader comparing two reviews joins their cases
 * on `id`, which the producer gave, never on a place.
 *
 * A region's `tests` are the test files of its cases, so the file leaves them
 * out and the reader derives them. A file without `version` is one written
 * before the case table, every region carrying its cases in full, and is read
 * as it stands.
 */

import { codeUnitOrder as order } from '@variance-authority/core/segment';
import { OperatorError } from '../exit.js';
import type { Review, ReviewCase, ReviewFile, ReviewRegion } from './review.js';

/** The shape `review.json` is written in. A file without the field is the shape before it: version 1. */
export const REVIEW_JSON_VERSION = 2;

export interface ReviewJsonRegion extends Omit<ReviewRegion, 'tests' | 'called'> {
  /** The places in {@link ReviewJson.cases} of the cases that entered it, ascending. */
  readonly called: readonly number[];
}

export interface ReviewJsonFile extends Omit<ReviewFile, 'regions'> {
  readonly regions?: readonly ReviewJsonRegion[];
}

export interface ReviewJson extends Omit<Review, 'files'> {
  readonly version: typeof REVIEW_JSON_VERSION;
  /** Every case some region names, once, by test file, title and id in code-unit order. */
  readonly cases: readonly ReviewCase[];
  readonly files: readonly ReviewJsonFile[];
}

/** The order a review lists cases in, and the order of the table: by test file, title, then the producer's id, which no two share. */
export function caseOrder(left: Pick<ReviewCase, 'file' | 'name' | 'id'>, right: Pick<ReviewCase, 'file' | 'name' | 'id'>): number {
  return order(left.file, right.file) || order(left.name, right.name) || order(left.id, right.id);
}

/** `review` as `review.json` writes it: `version` first, and `cases` just before `files`, so a reader meets the table before a region names it. */
export function reviewJson(review: Review): ReviewJson {
  const named = new Map<string, ReviewCase>();
  for (const file of review.files) for (const region of file.regions ?? []) for (const test of region.called) if (!named.has(test.id)) named.set(test.id, test);
  const cases = [...named.values()].sort(caseOrder);
  const place = new Map(cases.map((test, at) => [test.id, at]));
  const { files, ...rest } = review;
  return {
    version: REVIEW_JSON_VERSION,
    ...rest,
    cases,
    files: files.map(({ regions, ...file }) => regions === undefined ? file : {
      ...file,
      regions: regions.map(({ tests: _tests, called, ...region }) => ({
        ...region,
        called: called.map((test) => place.get(test.id)!).sort((left, right) => left - right),
      })),
    }),
  };
}

/**
 * The review a `review.json` holds. A file written before the case table is
 * the review as it stands; one written in this shape has each region's cases
 * and their test files put back from the table.
 */
export function reviewOfJson(kept: Review | ReviewJson): Review {
  if (!('version' in kept)) return kept;
  const { version, cases, files, ...rest } = kept;
  if (version !== REVIEW_JSON_VERSION) {
    const newer = typeof version === 'number' && version > REVIEW_JSON_VERSION;
    throw new OperatorError(`This review.json is version ${JSON.stringify(version)}, ${newer ? 'written by a newer variance than this one' : 'which no variance writes'}; this one reads versions up to ${REVIEW_JSON_VERSION}${newer ? ': upgrade @variance-authority/cli, or read the review.md beside it' : ''}.`);
  }
  return {
    ...rest,
    files: files.map(({ regions, ...file }) => regions === undefined ? file : {
      ...file,
      regions: regions.map(({ called: places, ...region }) => {
        const called = places.map((at) => cases[at]!);
        return { ...region, tests: [...new Set(called.map((test) => test.file))].sort(order), called };
      }),
    }),
  };
}
