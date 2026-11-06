/**
 * Say that a failure is the operator's to fix, not a bug in the tool.
 *
 * This package is reached through whichever copy of it a collector installed,
 * so an error class would not be recognised across that boundary. The contract
 * is the property name the CLI reads, as `@variance-authority/route-collector`
 * says at length.
 */
export function operatorError(message: string, options?: ErrorOptions): Error {
  return Object.assign(new Error(message, options), { varianceOperatorError: true });
}
