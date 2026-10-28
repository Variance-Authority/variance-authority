// compass: variance-authority/runtime/attention

/**
 * Which test files a record holds a file as a precondition of: the ones that
 * loaded it without instrumenting it, and the ones that declare it.
 *
 * `variance select` reads the same table (`testsGovernedBy`) and selects every
 * one of those files whole when the file changes, save a test whose row records
 * the text the change arrives at. `covering` names them and `review` counts them
 * from this one reading rather than two, without that exception: they ask about
 * a file, not a diff. Given the text held now, the exception is what
 * `covering` says of each test file: whether it ran that text.
 */

import { digestString } from '@variance-authority/core/format';
import { askCoverageFile, findModules, testsGovernedBy } from '@variance-authority/sense/test-selection';

/** What the record says about the asked files as preconditions. */
export interface HeldAsPrecondition {
  /** How many test files the record holds. */
  readonly tests: number;
  /**
   * Each asked file that some test file holds, with those test files in
   * code-unit order. A file no test file holds is absent. A test file is a
   * precondition of itself, and is not named for that.
   */
  readonly of: ReadonlyMap<string, readonly string[]>;
  /**
   * The asked files the run loaded: each has a module row in the record, with
   * blocks or, loaded without instrumenting it, with none. An asked file some test file holds and that is
   * not here is held only because the suite declares it, which is a statement
   * about the suite rather than a load anybody measured.
   */
  readonly loaded: ReadonlySet<string>;
  /**
   * Each asked file given a text, with the test files holding it whose row
   * records another text's digest, in code-unit order: they ran over another
   * text of it. A file every test file holding it ran the given text of is
   * absent, as is one given no text.
   */
  readonly ranOther: ReadonlyMap<string, readonly string[]>;
}

/**
 * {@link HeldAsPrecondition} for `files` in the record at `record`, with
 * `texts` the text each is held at now, or `undefined` when the record's
 * coverage cannot be read: a path that is not a coverage record, a record that
 * kept cases and no coverage, or one that does not decode. That is not the
 * same as no test file holding them, and a caller must not say it is.
 */
export function heldAsPrecondition(
  record: string,
  files: readonly string[],
  texts: ReadonlyMap<string, string> = new Map(),
): HeldAsPrecondition | undefined {
  try {
    return askCoverageFile(record, (coverage) => {
      const byFile = (tests: ReadonlyMap<number, readonly string[]>) => {
        const of = new Map<string, string[]>();
        for (const [test, names] of tests) {
          const own = coverage.string(coverage.testPath.at(test));
          for (const name of names) {
            if (name === own) continue;
            const holding = of.get(name) ?? [];
            holding.push(own);
            of.set(name, holding);
          }
        }
        for (const holding of of.values()) holding.sort();
        return of;
      };
      const of = byFile(testsGovernedBy(coverage, files).tests);
      const loaded = new Set(files.filter((file) => findModules(coverage, file).length > 0));
      // Read apart from `of`: a test that ran the held text is still one that holds the file.
      const arrived = new Map([...texts].map(([file, text]) => [file, digestString(text)]));
      const ranOther = arrived.size === 0 ? new Map<string, string[]>() : byFile(testsGovernedBy(coverage, [...arrived.keys()], arrived).tests);
      return { tests: coverage.testPath.length, of, loaded, ranOther };
    });
  } catch {
    return undefined;
  }
}
