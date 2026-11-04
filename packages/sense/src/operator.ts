/**
 * Say that a failure is the reader's to fix, not a bug in the tool.
 *
 * The CLI reads this package through its published entry, and prints anything
 * it does not recognise as a defect with a stack under it. A class shared across
 * that boundary would stop being recognised the moment two copies are installed,
 * so the contract is the property name the CLI reads.
 */
export function operatorError(message: string): Error {
  return Object.assign(new Error(message), { varianceOperatorError: true });
}
