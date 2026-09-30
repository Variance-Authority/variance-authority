import { EntrypointsError, parseEntrypoints } from '@variance-authority/sense/test-selection';
import { declaredTiers, parseTiers, TiersError, type Tiers } from '@variance-authority/sense';
import { OperatorError } from './exit.js';
import { fail, type ParseOptions } from './config-values.js';

/**
 * The sections a command reads through `@variance-authority/sense` rather than
 * through this config: `entrypoints`, where each part of the repository starts
 * for `variance coverage --from`, and `tiers`, the budgets `variance layers`
 * and a `maxTier` rule place packages against.
 *
 * Their rules live in sense and are carried here rather than written twice.
 * The config holds nothing parsed from them: this only refuses a value the
 * command would refuse later.
 */
export function parseDeclaredAt(root: Record<string, unknown>, options: ParseOptions): void {
  try {
    if (root['entrypoints'] !== undefined) parseEntrypoints(root['entrypoints'], options.source);
    if (root['tiers'] !== undefined) parseTiers(root['tiers'], options.source);
  } catch (error) {
    if (error instanceof EntrypointsError) fail(error.field, error.said, options);
    if (error instanceof TiersError) fail('tiers', error.said, options);
    throw error;
  }
}

/** The `tiers` the root config declares, or undefined when it declares none; a value its rules refuse stops the command. */
export function readTiers(root: string): Tiers | undefined {
  try {
    return declaredTiers(root);
  } catch (error) {
    if (error instanceof TiersError) throw new OperatorError(error.message);
    throw error;
  }
}
