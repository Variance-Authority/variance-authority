/**
 * What a region nothing was carried onto reads off the regions around it.
 *
 * A run's two records — the snapshot's rows and the case index — each place
 * held evidence on the regions cut now by identity, and a region the held cut
 * never had has no identity to be placed by. Both answer it with the nearest
 * region around it that something was carried onto; {@link crossingsAround}
 * says why. Both name that region by the owner the cut recorded: a row by its
 * owner's ordinal, a case index region by its owner's position among the
 * module's regions.
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
