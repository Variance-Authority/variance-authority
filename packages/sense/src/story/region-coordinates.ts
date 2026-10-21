/**
 * Where a region is, as one string a person can read and a reader can key by.
 *
 * A region is the file it is in, the declaration it belongs to and the
 * structure inside that declaration: `src/price.js#lineTotal/if#0/else`. The
 * top level has no name, so its own region is `src/price.js#module`. Two
 * declarations of one name — two functions called `total`, say — are told
 * apart by their order in the module: the second is `total~2`, and every
 * region and declaration inside it carries that, `…#total~2/if#0/then`,
 * whatever the first one holds.
 *
 * Nothing in it depends on lines or on the text's digest, so a region keeps its
 * coordinate across an edit that leaves its declaration and structure alone,
 * and two recordings of one file name the same region the same way.
 */

/**
 * Each region's coordinate, in the order `regions` holds them. A region belongs
 * to the last `entry` of its name at or before it. Each segment of a name is
 * numbered among its namesakes under the same numbered parent, so a function
 * nested in the second `handle` is `handle~2/inner`.
 */
export function coordinatesOf(
  file: string,
  regions: readonly { readonly name: string; readonly path: string }[],
): string[] {
  const declared = new Map<string, number>();
  const current = new Map<string, string>();
  const numbered = (name: string): string => {
    const known = current.get(name);
    if (known !== undefined) return known;
    const slash = name.lastIndexOf('/');
    return slash === -1 ? name : `${numbered(name.slice(0, slash))}${name.slice(slash)}`;
  };
  return regions.map(({ name, path }) => {
    if (name === '') return `${file}#${path}`;
    if (path === 'entry') {
      const slash = name.lastIndexOf('/');
      const unnumbered = slash === -1 ? name : `${numbered(name.slice(0, slash))}${name.slice(slash)}`;
      const nth = (declared.get(unnumbered) ?? 0) + 1;
      declared.set(unnumbered, nth);
      current.set(name, nth === 1 ? unnumbered : `${unnumbered}~${nth}`);
    }
    return `${file}#${numbered(name)}/${path}`;
  });
}
