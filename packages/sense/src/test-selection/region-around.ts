/**
 * What a region nothing was found for reads off the regions around it, up the
 * owners its cut recorded.
 *
 * The case index keeps a region's owner as its position among the regions a
 * transform wrote, and a region whose owner was not written takes the nearest
 * written one up its owners (`keptOwners` in `cases.ts`). The snapshot's rows
 * hand a region born in a re-cut the tests of the region around it by the same
 * owners (`around` in `record_coverage_layer.rs`). The case index's carry reads
 * its owner's decision as it walks the cut in order (`landedThrough` in
 * `region-edit.ts`), as the recut does, and needs no walk.
 */

/**
 * `held` of each region, and for a region `held` says nothing about, the
 * answer of the nearest region around it that it does; `none` when no region
 * up to the outermost does. `around` names the region one sits in, and nothing
 * at the outermost.
 *
 * Each region is resolved once and the answer is kept for the regions below
 * it, so a module costs one pass. A `seen` set stops a chain that points at
 * itself.
 */
export function heldAround<Region, Held>(
  around: (region: Region) => Region | undefined,
  held: (region: Region) => Held | undefined,
  none: Held,
): (region: Region) => Held {
  const resolved = new Map<Region, Held>();
  return (region: Region): Held => {
    const handed: Region[] = [];
    const seen = new Set<Region>();
    let at: Region | undefined = region;
    let answer = none;
    while (at !== undefined && !seen.has(at)) {
      seen.add(at);
      const already = resolved.get(at);
      if (already !== undefined) {
        answer = already;
        break;
      }
      const own = held(at);
      if (own !== undefined) {
        resolved.set(at, own);
        answer = own;
        break;
      }
      handed.push(at);
      at = around(at);
    }
    for (const row of handed) resolved.set(row, answer);
    return answer;
  };
}
