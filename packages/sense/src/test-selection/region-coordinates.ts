/**
 * Where a region is, as one string a person can read and a reader can key by.
 *
 * A region is the file it is in, the declaration it belongs to and the
 * structure inside that declaration: `src/price.js#lineTotal/if#0/else`. The
 * top level has no name, so its own region is `src/price.js#module`. Two
 * regions at one name and path — two functions of one name, say — are told
 * apart by their occurrence in the order the module holds them, as the
 * landings pair them ({@link addressKey}): the second is `…#total/entry~2`.
 *
 * Nothing in it depends on lines or on the text's digest, so a region keeps its
 * coordinate across an edit that leaves its declaration and structure alone,
 * and two recordings of one file name the same region the same way.
 */

import { addressKey } from './carried-rows.js';

/** Each region's coordinate, in the order `regions` holds them. */
export function coordinatesOf(
  file: string,
  regions: readonly { readonly name: string; readonly path: string }[],
): string[] {
  const seen = new Map<string, number>();
  return regions.map(({ name, path }) => {
    const nth = Number(addressKey(`${name}\0${path}`, seen).split('\0').at(-1));
    return `${file}#${name === '' ? '' : `${name}/`}${path}${nth === 1 ? '' : `~${nth}`}`;
  });
}
