import { count, freeze, plain, Shape, units, type Clock } from 'kit';
import { walk } from 'kit/extra';

/** What the app shows. */
export function shown(clock: Clock): number {
  return freeze(count(plain(1), units.metre, walk(2), new Shape().area(), clock.now()));
}
