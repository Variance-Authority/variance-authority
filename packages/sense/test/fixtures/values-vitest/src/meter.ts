import * as limits from './limits';

export function fill(value: number): number {
  return value / limits.LIMIT;
}

export function unit(): string {
  return '%';
}
