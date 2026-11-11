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
  /**
   * The record the selection read, as the `sha256:` digest of its bytes;
   * absent when it read none. A shard's record names it (`record-base.ts`).
   */
  readonly read?: string;
  /**
   * The test files in `skip` a leg or a local selection left for a later run,
   * reached or not: absent when the selection left none. `notes` names the
   * run that takes them.
   */
  readonly left?: ReadonlySet<string>;
  /**
   * The only test files that run, when a later wave of one shard was asked: a
   * file outside it, one the record never saw included, runs in an earlier
   * wave. Absent, every file not in `skip` runs.
   */
  readonly only?: ReadonlySet<string>;
  /**
   * The test files no wave of one shard runs, when this selection is one of its
   * waves. Absent, a shard places the files this selection keeps.
   */
  readonly skipEveryWave?: ReadonlySet<string>;
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
      /** That record, as the `sha256:` digest of its bytes, which a shard's record names (`record-base.ts`). */
      readonly read?: string;
      /** Repository-relative test file to the milliseconds its runner reported; an untimed file is absent. */
      readonly times: ReadonlyMap<string, number>;
      /** The commit the record was taken at; absent when it has no position. */
      readonly commit?: string;
    }
  | { readonly recording?: string; readonly unread: string };

/**
 * The test files a seam runs: those the runner discovered, less those the
 * selection skips. `name` says each file as `skip` names it, so a seam keeps
 * its runner's own handles; without it the files are those names. A file the
 * record never saw, or never held whole because it failed, is kept. A declined
 * reading skips nothing, so it keeps every file. A selection that names `only`
 * keeps none outside it.
 */
export function kept<File = string>(
  selection: SuiteSelection,
  discovered: readonly File[],
  name: (file: File) => string = String,
): readonly File[] {
  return [...new Set(discovered)].filter(
    (file) => !selection.skip.has(name(file)) && (selection.only === undefined || selection.only.has(name(file))),
  );
}

/**
 * The test files a seam under `--shard` places: those it keeps, or, for a wave
 * of one shard, every file the runner discovered that some wave runs. Each wave
 * then keeps its own files of one placement, so a shard's waves together take
 * the part the plan priced, rather than the heaviest part of each wave.
 */
export function placed<File = string>(
  selection: SuiteSelection,
  discovered: readonly File[],
  name: (file: File) => string = String,
): readonly File[] {
  const every = selection.skipEveryWave;
  if (every === undefined) return kept(selection, discovered, name);
  return [...new Set(discovered)].filter((file) => !every.has(name(file)));
}

/**
 * What a seam prints before the run: the count, or which reading declined,
 * then the notes.
 *
 * `discovered` is every test file the runner found, named as `skip` names
 * them. The count is of those, so a file the record never saw counts as
 * selected, which is what it is: it runs.
 *
 * A selection that keeps none of the files says none runs, and why: the
 * change reached none, or a leg or a local selection left them for a later run. That is
 * all it can say: Jest asks once per project, so what the runner does next is
 * not known here.
 */
export function selectedLines(selection: SuiteSelection, discovered: readonly string[]): readonly string[] {
  const all = new Set(discovered);
  const runs = kept(selection, discovered);
  const cut = runs.flatMap((file) => selection.cases?.get(file) ?? []).length;
  const inPart = runs.filter((file) => (selection.cases?.get(file)?.length ?? 0) > 0).length;
  const headline =
    selection.declined !== undefined
      ? `declined: ${selection.declined}`
      : runs.length === 0
        ? `selected none of ${all.size}, so none of them runs: ${none(selection, all)}`
        : `selected ${runs.length} of ${all.size}`;
  const part = cut === 0 ? '' : `, skipping ${count(cut, 'case')} in ${inPart} of them`;
  return [`variance-authority: ${headline}${part}`, ...selection.notes.map((note) => `  ${note}`)];
}

/** Why a selection that keeps no file kept none: what it left, or what the change reached. */
function none(selection: SuiteSelection, discovered: ReadonlySet<string>): string {
  const left = [...discovered].filter((file) => selection.left?.has(file) || selection.only?.has(file) === false).length;
  if (left === 0) return 'the change reached none of them';
  return `${count(left, 'test file')} ${left === 1 ? 'is' : 'are'} left for a later run`;
}

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`;
