import { measure, Reading } from 'alpha';
import { behind } from 'alpha/deep';

/** What beta is for. */
export function widths(): number {
  return measure(1) + new Reading().at + behind.length;
}
