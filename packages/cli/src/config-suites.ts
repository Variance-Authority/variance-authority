import { parseSuites, SuitesError, type DeclaredSuite } from '@variance-authority/sense/test-selection';
import { fail, type ParseOptions } from './config-values.js';

export type { DeclaredSuite };

/**
 * The `suites` section: each suite the repository runs, and what kind it is.
 *
 * The declaration belongs to the test runner seams, which read the root file
 * themselves, so its rules live in `@variance-authority/sense` and are carried
 * here rather than written twice. A refusal comes back in this file's shape,
 * naming the field.
 */
export function parseSuitesAt(value: unknown, options: ParseOptions): readonly DeclaredSuite[] {
  try {
    return parseSuites(value, options.source);
  } catch (error) {
    if (error instanceof SuitesError) fail(error.field, error.said, options);
    throw error;
  }
}
