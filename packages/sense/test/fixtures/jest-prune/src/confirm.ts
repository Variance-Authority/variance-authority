import { pad } from './format';

export function confirm(answer: boolean): string {
  return answer ? 'yes' : 'no';
}
export function padded(answer: boolean): string {
  return pad(confirm(answer));
}
