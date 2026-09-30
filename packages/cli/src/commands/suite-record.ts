// compass: variance-authority.reach

import type { DeclaredSuite } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { messageOf } from '../config-values.js';

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
 * The path is the nearest cache layer holding the record, which in a worktree
 * that has not run is the primary checkout's: sense's `readableTestCoverage`
 * owns that lookup. What is read beside the record — its case index, its runs
 * — is read beside this path, so from the same layer.
 */
export async function suiteRecord(root: string, suite?: string): Promise<string> {
  return (await recordedSuite(root, suite)).file;
}

/**
 * Where a command that writes the record lands it: this checkout's own layer,
 * which is the one layer it may write, whatever {@link suiteRecord} would read.
 */
export async function landingRecord(root: string, suite?: string): Promise<string> {
  return (await recordedSuite(root, suite, 'landing')).file;
}

/**
 * {@link suiteRecord}, with the declaration the path was resolved from: a
 * reader that falls back to the record a share holds asks the declaration
 * whether the share holds one.
 */
export async function recordedSuite(
  root: string,
  suite?: string,
  purpose: 'reading' | 'landing' = 'reading',
): Promise<{ readonly file: string; readonly declared?: DeclaredSuite }> {
  const selection = await import('@variance-authority/sense/test-selection');
  try {
    const declared = selection.declaredSuites(root);
    const only = suite ?? (declared?.length === 1 ? declared[0]!.name : undefined);
    if (only === undefined && declared !== undefined) {
      throw new OperatorError(
        `the root variance.config.json declares the suites ${declared.map((one) => `"${one.name}"`).join(', ')}, ` +
          'and each records on its own; pass `--suite <name>` to say which record to read',
      );
    }
    const file = purpose === 'landing'
      ? selection.testCoverageFile(root, { suite: only })
      : await selection.readableTestCoverage(root, { suite: only });
    const named = declared?.find((one) => one.name === only);
    return named === undefined ? { file } : { file, declared: named };
  } catch (error) {
    if (error instanceof OperatorError) throw error;
    throw new OperatorError(messageOf(error), { cause: error });
  }
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
