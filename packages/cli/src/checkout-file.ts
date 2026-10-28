import { checkoutPath } from '@variance-authority/sense';
import { OperatorError } from './exit.js';

/**
 * A path argument as the record spells it, checkout-relative with `/`, or the
 * operator's refusal of a path outside `root`.
 *
 * A path names one file or directory: nothing is matched by suffix, name or
 * text, so a path no row holds is answered as that by the command reading it.
 * `flag`, when given, opens the refusal, for a command that takes more than one
 * path.
 */
export function checkoutFile(root: string, asked: string, flag?: string): string {
  const path = checkoutPath(root, asked);
  if ('outside' in path) throw new OperatorError(flag === undefined ? path.outside : `\`${flag}\`: ${path.outside}`);
  return path.path;
}
