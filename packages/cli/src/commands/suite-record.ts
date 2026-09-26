// compass: variance-authority.reach

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
 */
export async function suiteRecord(root: string, suite?: string): Promise<string> {
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
    return selection.testCoverageFile(root, { suite: only });
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
