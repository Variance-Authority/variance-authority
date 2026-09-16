import type { Landmark } from '@variance-authority/report';

/**
 * What holds what, which is the instrument that needs no rectangles.
 *
 * Twice now the answer has turned on it. A description naming a thing and what
 * it sits in — *the Pickup window on the dispatch drawer* — is a path, and the
 * enclosed end is what it named even when the enclosing end scores higher; and
 * where several candidates all stand in the asked relation, the enclosed one is
 * again the thing meant. Depth substitutes for size, so a run that resolved no
 * layout still answers.
 */
export function enclosedBy(landmarks: readonly Landmark[], at: number, ancestor: number): boolean {
  let held = landmarks[at]?.within;
  while (held !== undefined) {
    if (held === ancestor) return true;
    held = landmarks[held]?.within;
  }
  return false;
}

/** The landmarks enclosing one, outermost first. Where on the surface it is. */
export function enclosing(landmarks: readonly Landmark[], at: number): readonly Landmark[] {
  const chain: Landmark[] = [];
  let held = landmarks[at]?.within;
  while (held !== undefined) {
    const landmark = landmarks[held];
    if (landmark === undefined) break;
    chain.unshift(landmark);
    held = landmark.within;
  }
  return chain;
}

/**
 * The deepest candidate inside the best one, or the best one.
 *
 * *The Assignee warning on the create issue dialog* names two things and one of
 * them is where the other is. The dialog can outscore the warning outright —
 * two rare words against one — so no tie-break reaches the answer. But both
 * scored, and one contains the other, which is the phrase saying it named a
 * path: what encloses is the place, what is enclosed is the thing. Containment
 * says which is which, and containment is recorded whether or not the run
 * resolved layout.
 */
export function deepestUnder(
  landmarks: readonly Landmark[],
  candidates: readonly { at: number; score: number }[],
  best: number,
): number {
  let held = best;
  let depth = -1;
  for (const candidate of candidates) {
    if (candidate.at === best) continue;
    const chain = enclosing(landmarks, candidate.at);
    if (!chain.includes(landmarks[best]!)) continue;
    if (chain.length > depth) {
      depth = chain.length;
      held = candidate.at;
    }
  }
  return held;
}
