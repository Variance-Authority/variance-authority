import { EntrypointsError, parseEntrypoints } from '@variance-authority/sense/test-selection';
import { fail, type ParseOptions } from './config-values.js';

/**
 * The `entrypoints` section: where each part of the repository starts, for
 * `variance coverage --from`.
 *
 * `variance coverage` reads the root file through `@variance-authority/sense`,
 * so its rules live there and are carried here rather than written twice. The
 * config holds nothing parsed from it: this only refuses a value the command
 * would refuse later.
 */
export function parseEntrypointsAt(value: unknown, options: ParseOptions): void {
  try {
    parseEntrypoints(value, options.source);
  } catch (error) {
    if (error instanceof EntrypointsError) fail(error.field, error.said, options);
    throw error;
  }
}
