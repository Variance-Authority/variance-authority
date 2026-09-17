import { entryPoints, pathsOf, refusalFor, type Tree } from '@variance-authority/mcp/tools';

/**
 * Which part of the repository an answer is allowed to come from.
 *
 * A search over names is a search over the whole checkout, and on a repository
 * with a hundred thousand files that is not a narrowing anybody can use. Every
 * product word is written somewhere in every area: `order` matches four hundred
 * names, the reader wanted the nine in the fulfilment service, and no ranking
 * over the *text* can tell those apart, because the text really does say it
 * four hundred times.
 *
 * What separates them is not a better score. It is a fact the caller already
 * holds and the search never asked for: which part of the repository they are
 * standing in. A start point is that fact, said as a path.
 *
 * ## It removes names, it does not prefer them
 *
 * A name declared outside the closure is not ranked low, it is not there. That
 * is the difference between a filter and a hint, and the reason to want the
 * first: a hint still hands back four hundred matches and asks the reader to
 * trust an order, and an answer that says *nine names, in the files this route
 * reaches* is one they can act on without trusting anything.
 *
 * It also makes the empty answer worth something. *Nothing here is named
 * `settle`* is a fact about the area, and the caller who reads it has learned
 * where not to look rather than that the ranking disagreed with them.
 *
 * ## The two directions ask different questions
 *
 * `from` is answered along the imports: the names in reach of a file, which is
 * the vocabulary available where the caller is working. `to` is answered
 * against them: the names declared in files that reach a destination, which is
 * how the callers of a thing are found when the thing is what you have.
 *
 * Said together they are two start points and not one, unioned rather than
 * crossed, for the same reason [`scope.ts`](../../../mcp/src/tools/scope.ts)
 * gives: two entry points of one application share almost no file, so an
 * intersection answers nothing at exactly the moment the caller was most
 * specific.
 *
 * ## The rule about paths is not this module's to invent
 *
 * What a path means — three widths, anchored at the root, compared segment for
 * whole segment, not found rather than guessed at — belongs to
 * [`start-point.ts`](../../../mcp/src/tools/start-point.ts) and is imported
 * from there. A second server that wrote its own would drift, and the drift
 * lands on the reader as `src/billing/` meaning one thing in one tool and
 * something else in the next.
 */

/** A start point, resolved against the tree, as the files it allows. */
export interface Area {
  /** The paths answered along the imports, as said. */
  readonly from: readonly string[];
  /** The paths answered against the imports, as said. */
  readonly to: readonly string[];
  /** Files the paths themselves named. */
  readonly entries: number;
  /** The closure: every file in reach, entry points included. */
  readonly files: ReadonlySet<string>;
  /** Files in it whose own imports the scan could not enumerate. */
  readonly unresolved: readonly string[];
  /** Why it was not resolved. Absent when it was. */
  readonly refused?: string;
}

const NOWHERE = {
  from: [] as readonly string[],
  to: [] as readonly string[],
  entries: 0,
  files: new Set<string>() as ReadonlySet<string>,
  unresolved: [] as readonly string[],
};

/** Resolve a start point, or say why it could not be. */
export function areaOf(
  from: string | readonly string[] | undefined,
  to: string | readonly string[] | undefined,
  tree: Tree | undefined,
): Area {
  const fromTerms = pathsOf(from);
  const toTerms = pathsOf(to);

  if (fromTerms.length === 0 && toTerms.length === 0) {
    return { ...NOWHERE, refused: 'no start point was said' };
  }

  // No tree, no answer. The reading knows which file declares each name, and
  // answering from *that* — every name whose path happens to begin with the
  // same segments — would be a different question wearing this one's clothes:
  // a folder is not a closure, and the imports are the whole point.
  if (tree === undefined) {
    return {
      ...NOWHERE,
      refused:
        'a start point is a path in the source tree, and no source tree was read. Ask from a ' +
        'checkout of the workspace, or ask without a start point',
    };
  }

  const down = entryPoints(fromTerms, tree);
  const up = entryPoints(toTerms, tree);

  const refused = refusalFor([...down.unmatched, ...up.unmatched]);
  if (refused !== undefined) return { ...NOWHERE, from: down.found, to: up.found, refused };

  const files = new Set([...tree.reachedFrom(down.files), ...tree.reaching(up.files)]);

  return {
    from: down.found,
    to: up.found,
    entries: new Set([...down.files, ...up.files]).size,
    files,
    unresolved: tree.unknownAmong(files),
  };
}

/**
 * What the header says about a start point, before any match.
 *
 * Always printed when one was given, including — especially — when it named
 * nothing, because the difference between *this area holds no such name* and
 * *there is no such area* is the difference between asking again and asking
 * somewhere else, and only the tool knows which happened.
 */
export function areaLine(area: Area): string {
  if (area.refused !== undefined) {
    return (
      `No search was run: ${area.refused}. ` +
      'Say a real path from the root — `src/dispatch/read.ts` is that file, `src/dispatch/*` ' +
      "its folder's own files, `src/dispatch/` everything under it. A name on its own is not " +
      'a path. To search the whole workspace, leave the start point out.'
    );
  }

  // Counted and said rather than widened over. A file whose imports could not
  // be enumerated may import anything, so the closure is not a proof about what
  // it leaves out — but unioning in every file that reaches an unknown one is a
  // large fixed fraction of any repository, which is not a narrowing the caller
  // would recognise as one.
  const holes =
    area.unresolved.length === 0
      ? ''
      : ` ${area.unresolved.length} file(s) in it import something the scan could not resolve, ` +
        'so what lies behind those is not enumerated.';

  // The direction is said, not implied by the number. *Reachable from the
  // dispatch route* and *reaching the date helper* are different questions with
  // the same shape of answer, and a header that printed one sentence for both
  // would leave the reader unable to tell which was asked.
  const named = (places: readonly string[]): string => places.map((place) => `\`${place}\``).join(' and ');
  const along = area.from.length === 0 ? '' : `reachable from ${named(area.from)}`;
  const against = area.to.length === 0 ? '' : `reaching ${named(area.to)}`;

  return (
    `In ${area.files.size} file(s) ${[along, against].filter((half) => half !== '').join(' or ')} ` +
    `along the imports, at any depth — ${area.entries} named by the path itself.${holes}`
  );
}
