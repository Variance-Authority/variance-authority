/**
 * Say that a failure is the reader's to fix, not a bug in the tool.
 *
 * `variance ask` reads this package through its published entry, and prints
 * anything it does not recognise as a defect with a stack under it. A class
 * shared across that boundary would stop being recognised the moment two copies
 * are installed, so the contract is the property name the CLI reads.
 *
 * Use it for a refusal that names its remedy — nothing published to read, when
 * reading only what is published was the request. Leave a bare `Error` where
 * the cause really is this package.
 */
export function operatorError(message: string, options?: ErrorOptions): Error {
  return Object.assign(new Error(message, options), { varianceOperatorError: true });
}
