/**
 * Which file a directory is meant to be entered by.
 *
 * [`distance.ts`](./distance.ts) can say a change travelled four hops without
 * any of this. What it cannot say without a face is whether any of those hops
 * was one somebody was not offered — and that is the half that turns a distance
 * into a work item, because a long path through public faces is a design and a
 * short path that reached inside one is a defect.
 *
 * The convention read here is the one a directory declares about itself: a
 * directory holding an `index` module is a unit, and that module is its face.
 * Nothing is configured and nothing is inferred from a name — a directory that
 * does not want to be a unit does not write an index, and this reports nothing
 * about it. That is why the rule is worth having: it is already the convention
 * the repository being read is keeping, or it is not, and either way this agrees
 * with it.
 *
 * A manifest is the other place a unit declares its face, and a package that
 * publishes `exports` has said which subpaths it offers in a form nothing has to
 * guess at. Reading one requires knowing where a published subpath's source is,
 * which for a package shipping compiled output means reading its build config —
 * a requirement {@link Faces} exists to keep out of here (ADR-0013). A caller
 * holding that reading hands over its own provider, and {@link eitherFace}
 * stacks it in front of this one.
 */

import { nodeAt, nodesOfKind, type Relations } from '@variance-authority/core/relate';
import type { Face, Faces } from './distance.js';

const INDEX = /^index\.[cm]?[jt]sx?$/;

/**
 * Faces from the graph alone: a directory with an index module is entered by it.
 *
 * ## The outermost face the importer is outside of
 *
 * `src/button/parts/glyph.ts` sits in two units when both `src/button` and
 * `src/button/parts` hold an index, and which one was reached past depends on
 * where the import was written. From `src/checkout/page.tsx`, both were, and
 * `src/button` is the answer worth printing: whoever wrote that line is not
 * being told to reach one directory less far in, they are being told the
 * component has a front door. From `src/button/index.ts` only `parts` was, and
 * the front door is the file asking. So the walk goes up from the reached file
 * and keeps the highest unit the importer is not itself inside.
 *
 * A file that *is* an index is nobody's reach-through, however deep it sits.
 * That is what being the face means, and it is what makes a barrel re-exporting
 * a sibling's internals report at the barrel rather than at every line that
 * imported the barrel.
 */
export function indexFaces(relations: Relations): Faces {
  const entries = new Map<string, string>();
  for (const id of nodesOfKind(relations, 'file')) {
    const name = nodeAt(relations, id)?.name;
    if (name === undefined) continue;
    const cut = name.lastIndexOf('/');
    if (!INDEX.test(name.slice(cut + 1))) continue;
    const directory = cut < 0 ? '' : name.slice(0, cut);
    // Two index modules in one directory is a build's business, not ours; the
    // first in code-unit order is taken so the reading is stable either way.
    const already = entries.get(directory);
    if (already === undefined || name < already) entries.set(directory, name);
  }

  return (reached: string, importer: string): Face | undefined => {
    let outermost: Face | undefined;
    for (let cut = reached.lastIndexOf('/'); cut > 0; cut = reached.lastIndexOf('/', cut - 1)) {
      const unit = reached.slice(0, cut);
      const entry = entries.get(unit);
      if (entry === undefined || entry === reached) continue;
      if (importer === unit || importer.startsWith(`${unit}/`)) continue;
      outermost = { unit, entry };
    }
    return outermost;
  };
}

/**
 * The first provider with an answer, in the order given.
 *
 * Order is precedence, and the caller's own reading goes first: a manifest that
 * says a package is entered at `src/index.ts` settles the question for every
 * file under it, and a nested index inside that package is a smaller unit whose
 * boundary the manifest never spoke about.
 */
export function eitherFace(...providers: readonly Faces[]): Faces {
  return (reached: string, importer: string): Face | undefined => {
    for (const provider of providers) {
      const face = provider(reached, importer);
      if (face !== undefined) return face;
    }
    return undefined;
  };
}
