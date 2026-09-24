import * as limits from './limits';

const known: object[] = [];
known.push(limits);

export function count(): number {
  return known.length;
}
