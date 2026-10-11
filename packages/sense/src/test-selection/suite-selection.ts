/**
 * The selection a seam is handed, and what it says about it.
 *
 * The seam is the runner's half: it knows where its runner drops a file and
 * nothing about how the selection was read. The reading is computed above this
 * package, once per run, and handed in as a value: `selectSuite` in
 * `@variance-authority/cli` composes it, and the seam asks for it when
 * `VARIANCE_AUTHORITY_SINCE` is set (`selection-environment.ts`).
 */

/** One suite's selection, as repository-relative test files. */
export interface SuiteSelection {
  /** The suite's test files the record holds whole. */
  readonly whole: ReadonlySet<string>;
  /**
   * Safe to skip: recorded whole, and no changed line reached them. A file the
   * runner discovers and the record never saw is not here, so it runs.
   */
  readonly skip: ReadonlySet<string>;
  /**
   * Test files that run in part: each to the names of the cases the run may
   * skip there, spelled as the record names them. A case not named runs, and
   * so does every case of a file not here. Absent, every file that runs, runs
   * whole, which is the file grain and the default.
   */
  readonly cases?: ReadonlyMap<string, readonly string[]>;
  /** Which reading could not be made, when one could not: nothing is skipped. */
  readonly declined?: string;
  /** What a person reads after the count. Never parsed. */
  readonly notes: readonly string[];
}

/**
 * The milliseconds a suite's record holds for each of its test files, which is
 * what a seam under `--shard` places them by, or why there are none to read.
 */
export type SuiteTimes =
  | {
      /** The record the times were read from. */
      readonly recording: string;
      /** Repository-relative test file to the milliseconds its runner reported; an untimed file is absent. */
      readonly times: ReadonlyMap<string, number>;
      /** The commit the record was taken at; absent when it has no position. */
      readonly commit?: string;
    }
  | { readonly recording?: string; readonly unread: string };

/**
 * What a seam prints before the run: the count, or which reading declined,
 * then the notes.
 *
 * `discovered` is every test file the runner found, named as `skip` names
 * them. The count is of those, so a file the record never saw counts as
 * selected, which is what it is: it runs.
 */
export function selectedLines(selection: SuiteSelection, discovered: readonly string[]): readonly string[] {
  const all = new Set(discovered);
  const kept = [...all].filter((file) => !selection.skip.has(file));
  const cut = kept.flatMap((file) => selection.cases?.get(file) ?? []).length;
  const inPart = kept.filter((file) => (selection.cases?.get(file)?.length ?? 0) > 0).length;
  const headline =
    selection.declined !== undefined
      ? `declined: ${selection.declined}`
      : kept.length === 0
        ? `selected none of ${all.size}`
        : `selected ${kept.length} of ${all.size}`;
  const part = cut === 0 ? '' : `, skipping ${count(cut, 'case')} in ${inPart} of them`;
  return [`variance-authority: ${headline}${part}`, ...selection.notes.map((note) => `  ${note}`)];
}

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;
