import { runInNewContext } from 'node:vm';

/** The name of the realm `inPage` runs a function in. */
export const REALM = 'page';

/** Run `fn` in a realm of its own, from its text, the way a browser runs a function handed to a page. */
export function inPage<T>(fn: () => T): T {
  return runInNewContext(`(${fn.toString()})()`) as T;
}
