import { LIMIT as max } from './limits';

export function slide(value: number): number {
  return value > max ? max : value;
}

export function label(): string {
  return 'slider';
}
