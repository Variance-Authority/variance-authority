import { NameGrammarError, parseNameGrammar, type NameGrammar } from '@variance-authority/sense/test-selection';
import { fail, type ParseOptions } from './config-values.js';

/**
 * The `names` section: the grammar a repository's subject ids and case
 * preconditions are read on.
 *
 * `variations` reads the grammar for a subject's parent and `covering` for a
 * case's axis and twin, so its rules live in `@variance-authority/sense` beside
 * the reading and are carried here rather than written twice. A refusal comes
 * back in this file's shape, naming the field.
 */
export function parseNames(value: unknown, options: ParseOptions): NameGrammar {
  try {
    return parseNameGrammar(value, options.source);
  } catch (error) {
    if (error instanceof NameGrammarError) fail(error.field, error.said, options);
    throw error;
  }
}
