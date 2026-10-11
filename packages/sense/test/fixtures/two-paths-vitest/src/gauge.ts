import { unit } from './bounds';
import { ceiling } from './ceiling';

export function full(): number {
  return ceiling;
}

export function label(): string {
  return unit();
}
