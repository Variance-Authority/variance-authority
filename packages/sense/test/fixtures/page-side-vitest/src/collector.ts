import { REALM } from './index';
import { visit } from './world';

export function collect(): string[] {
  return [REALM, ...visit().split(':')];
}
