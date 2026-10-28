// compass: variance-authority.reach.crossings
/**
 * Coverage in and out: what a package's own tests run from next to the code,
 * and what every other test runs.
 *
 * A region is *in* when a test of the package that holds it called into it
 * from at most one import hop away: the test imports the code it ran. It is
 * *out* when any other test called into it: another package's, or the
 * package's own from further away. The two are separate coverages over the
 * same regions, not halves of one, so both can reach 100%: the end-to-end suite
 * that passes runs everything out, and the unit next to each file runs it in.
 * *Accidental* is out and not in: code something ran on its way to
 * something else, and no test of its own package within one hop ran.
 *
 * The hops are the ones {@link testHops} walks, the owner the caller's, and the regions
 * and their callers are {@link calledRegions}'s, the pass {@link coverageByOwner}
 * counts over. A test no walk placed is never in, since an unmeasured
 * distance is not a short one; what only such tests ran is counted apart as
 * unmeasured. A hop is any runtime import, a re-export or a test helper as well.
 */

import type { SuiteKind } from './suites.js';
import type { TestHops } from './coverage-distance.js';
import type { CountedSuite } from './coverage-count.js';
import { calledRegions } from './coverage-owner.js';

/** In and out over one set of regions. */
export interface EarnedCount {
  /** Source regions in files that are not tests. */
  readonly regions: number;
  /** Regions a test of their own package called into from at most one import hop. */
  readonly in: number;
  /** Regions any other test called into. */
  readonly out: number;
  /** Regions out and not in. */
  readonly accidental: number;
  /** Accidental regions no test that ran them had a measured distance to. */
  readonly unmeasured: number;
}

/** In and out for each suite, and for every suite joined. */
export interface EarnedCoverage {
  /** Per suite, in the order given. */
  readonly suites: readonly (EarnedCount & { readonly name?: string; readonly kind?: SuiteKind })[];
  /** Every suite's regions joined by address: in when any suite has it in. */
  readonly total: EarnedCount;
}

/** Bits of what ran a region. */
const IN = 1;
const OUT = 2;
const MEASURED = 4;

/** Count each suite's regions in and out, and every suite's joined. */
export function earnedCoverage(suites: readonly CountedSuite[], ownerOf: (file: string) => string, walked: TestHops): EarnedCoverage {
  const marks = suites.map((): number[] => []);
  // file and address and kind → what ran it, over every suite.
  const joined = new Map<string, number>();
  for (const { suite, file, key, tests } of calledRegions(suites)) {
    const owner = ownerOf(file);
    let mark = 0;
    for (const test of tests) {
      const hop = walked.hops.get(test)?.get(file);
      if (hop !== undefined) mark |= MEASURED;
      mark |= hop !== undefined && hop <= 1 && ownerOf(test) === owner ? IN : OUT;
    }
    marks[suite]!.push(mark);
    const at = `${file}\0${key}`;
    joined.set(at, (joined.get(at) ?? 0) | mark);
  }
  const counted = suites.map((suite, at) => ({
    ...(suite.name === undefined ? {} : { name: suite.name }), ...(suite.kind === undefined ? {} : { kind: suite.kind }), ...tally(marks[at]!),
  }));
  return { suites: counted, total: tally(joined.values()) };
}

function tally(marks: Iterable<number>): EarnedCount {
  let regions = 0, inside = 0, out = 0, accidental = 0, unmeasured = 0;
  for (const mark of marks) {
    regions += 1;
    if (mark & IN) inside += 1;
    if (mark & OUT) out += 1;
    if ((mark & OUT) && !(mark & IN)) {
      accidental += 1;
      if (!(mark & MEASURED)) unmeasured += 1;
    }
  }
  return { regions, in: inside, out, accidental, unmeasured };
}
