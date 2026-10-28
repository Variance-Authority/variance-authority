import { cls } from './cls';
export const tone = css((props: { on: boolean }) => props.on ? 'red' : 'blue');
export function label(pressed: boolean): string {
  if (pressed) return tone({ on: true });
  return tone({ on: false });
}
export function shade(dark: boolean): string {
  if (dark) return tone({ on: true });
  return tone({ on: false });
}
declare function css<T>(style: (props: T) => string): (props: T) => string;
void cls;
