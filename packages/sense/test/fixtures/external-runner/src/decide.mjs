import { label } from './label.cjs';
import { weigh } from './weigh.mts';

export function decide(value) {
  if (value === 'alpha') {
    return label('A');
  }
  return `${label('B')}, ${weigh(value)}`;
}
