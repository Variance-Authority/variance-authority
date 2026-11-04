// compass: variance-authority.reach

import type { DeclaredSuite, Precision, Unmeasured } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { messageOf } from '../config-values.js';
import { noteSelectedMainline, onlySuite } from './mainline-selected.js';

/**
 * The one record a command scoped to one runner reads: `--suite`'s, or the only
 * suite's the root config declares, or the repository's one record when it
 * declares none.
 *
 * `select`, `run --since` and `journeys` each answer for one runner's cases, so
 * they read one suite, and with more than one declared, picking one for the
 * operator would read a record they did not ask about. The declaration and
 * the path are sense's; the default is this reader's, because it is a rule
 * about what a person typed, not about where a run records.
 *
 * The path is the nearest record, which in a checkout that has not run is the
 * mainline's as last fetched on this machine, else, in a worktree, the primary
 * checkout's: sense's `readableTestCoverage` owns that lookup, and it never
 * fetches. The case index is read beside this path, so from the same
 * layer as the record it was written with. The runs log is not: it says where
 * this checkout's change starts and which files this checkout ran, so it is
 * read from {@link ownRecord}'s layer and is absent until this checkout has
 * run.
 */
export async function suiteRecord(root: string, suite?: string): Promise<string> {
  return (await recordedSuite(root, suite)).file;
}

/**
 * {@link suiteRecord} for a read the command runs without: none when more than
 * one suite is declared and none is named.
 *
 * Plain `variance run` reads where its subjects parted in the source, and that
 * reading refines a report the run makes anyway. Refusing the run over it
 * would make every repository that declares a second suite pass `--suite` to a
 * command that never asked for a record.
 */
export async function refiningRecord(root: string, suite?: string): Promise<string | undefined> {
  if (suite === undefined) {
    const selection = await import('@variance-authority/sense/test-selection');
    let several: boolean;
    try {
      several = (selection.declaredSuites(root)?.length ?? 0) > 1;
    } catch (error) {
      throw new OperatorError(messageOf(error), { cause: error });
    }
    if (several) return undefined;
  }
  return suiteRecord(root, suite);
}

/** This checkout's own layer, the one layer it may write, whatever {@link suiteRecord} would read. */
export async function ownRecord(root: string, suite?: string): Promise<string> {
  const selection = await import('@variance-authority/sense/test-selection');
  const { name } = await namedSuite(root, suite);
  return asOperator(() => selection.testCoverageFile(root, { suite: name }));
}

/**
 * Where a command that writes the record lands it: {@link ownRecord}, with the
 * selection noted, because a first landing lays its base by the note.
 */
export async function landingRecord(root: string, suite?: string): Promise<string> {
  const file = await ownRecord(root, suite);
  await noteSelectedMainline(root, suite);
  return file;
}

/**
 * {@link suiteRecord}, with what its suite does with a file the record did not
 * measure — a suite declaring `relations: false` asks the graph nothing — and
 * the precision and the `ignore` globs it declares.
 */
export async function selectingRecord(
  root: string,
  suite?: string,
): Promise<{
  readonly file: string;
  readonly unmeasured?: Unmeasured;
  readonly precision?: Precision;
  readonly ignore?: readonly string[];
}> {
  const { file, declared } = await recordedSuite(root, suite);
  const { unmeasuredOf } = await import('@variance-authority/sense/test-selection');
  const unmeasured = unmeasuredOf(declared);
  return {
    file,
    ...(unmeasured === undefined ? {} : { unmeasured }),
    ...(declared?.precision === undefined ? {} : { precision: declared.precision }),
    ...(declared?.ignore === undefined ? {} : { ignore: declared.ignore }),
  };
}

/**
 * {@link suiteRecord}, with the declaration the path was resolved from: a
 * reader that falls back to the record a share holds asks the declaration
 * whether the share holds one.
 */
export async function recordedSuite(root: string, suite?: string): Promise<{ readonly file: string; readonly declared?: DeclaredSuite }> {
  const selection = await import('@variance-authority/sense/test-selection');
  const { name, declared } = await namedSuite(root, suite);
  try {
    const selected = await noteSelectedMainline(root, name);
    const file = await selection.readableTestCoverage(root, { suite: name, selected });
    return declared === undefined ? { file } : { file, declared };
  } catch (error) {
    if (error instanceof OperatorError) throw error;
    throw new OperatorError(messageOf(error), { cause: error });
  }
}

/**
 * The suite a command scoped to one runner reads, and its declaration when it
 * has one: `--suite`, or the only one declared, and refused where several are
 * and none is named.
 */
export async function namedSuite(root: string, suite?: string): Promise<{ readonly name: string | undefined; readonly declared?: DeclaredSuite }> {
  const selection = await import('@variance-authority/sense/test-selection');
  const declared = asOperator(() => selection.declaredSuites(root));
  const name = suite ?? onlySuite(declared);
  if (name === undefined && declared !== undefined) {
    throw new OperatorError(
      `the root variance.config.json declares the suites ${declared.map((one) => `"${one.name}"`).join(', ')}, ` +
        'and each records on its own; pass `--suite <name>` to say which record to read',
    );
  }
  const named = declared?.find((one) => one.name === name);
  return named === undefined ? { name } : { name, declared: named };
}

/** Run a read whose refusal is the operator's: whatever it throws is said as an {@link OperatorError}. */
export function asOperator<T>(read: () => T): T {
  try {
    return read();
  } catch (error) {
    if (error instanceof OperatorError) throw error;
    throw new OperatorError(messageOf(error), { cause: error });
  }
}

/**
 * The refusal of a reading across records when none holds a per-case index:
 * the repository's one record, or every suite it declares, named.
 */
export function nothingRecorded(root: string, suites?: readonly string[]): OperatorError {
  return new OperatorError(
    suites === undefined
      ? `nothing is recorded in \`${root}\`: no run left a per-case index, so no case can be named.`
      : `nothing is recorded in \`${root}\`: none of the suites it declares, ${
          suites.map((name) => `"${name}"`).join(', ')
        }, has a per-case index, so no case can be named.`,
    { kind: 'unrecorded' },
  );
}

/**
 * Refuse `--suite` beside a flag that names the record by path: both say which
 * record, and honouring one would read or write where the operator did not look.
 */
export function oneRecord(suite: string | undefined, path: string | undefined, flag: string): void {
  if (suite !== undefined && path !== undefined) {
    throw new OperatorError(`\`--suite\` and \`${flag}\` both name the record; pass one`);
  }
}
