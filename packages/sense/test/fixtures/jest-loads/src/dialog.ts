import { edit } from './editor';
import { fallback } from './fallback';
import { confirm } from './confirm';

export function open(): string {
  return 'open';
}
export function click(answer: boolean): string {
  return confirm(answer);
}
export const handlers = { edit, fallback };
