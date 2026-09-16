import type { Landmark, RunReport } from '@variance-authority/report';
import { codeUnit, partsOf, tokensOf } from './locate-index.js';
import { readQuestion, type Asked, type Relation } from './question.js';
import { holdersAmong, orientIndexOf } from './holds.js';
import { deepestUnder, enclosedBy, enclosing } from './containment.js';
import { scopeOf, type Scope } from './scope.js';

/**
 * Where on a screen, rather than which screen.
 *
 * `variance_locate` answers *which subject do I mean* from a description. The
 * question that arrives before it is usually one step longer than that — **the
 * warning underneath the carrier field on the dispatch drawer** — and it names
 * three things and one relation between two of them. Nothing in a bag of words
 * can answer it: a bag holds `carrier` and holds `contract` and cannot hold the
 * fact that the second sits beneath the first.
 *
 * The lexicon's landmarks can, so this reads them. Three steps, and each is
 * cheap for a different reason:
 *
 * 1. **Which surfaces hold both at all.** A per-subject filter over the words
 *    that subject's landmarks say, tested for the anchor's words and the
 *    target's words together. It is allowed to say *maybe* and never *no* when
 *    the answer is yes, so a survivor list is a superset and nothing correct is
 *    ever discarded here. This is the step that has to survive twenty thousand
 *    stories, and it does because it is a few words of memory per story rather
 *    than a posting list per token.
 * 2. **Where the anchor is, on each survivor.** An exact walk of that subject's
 *    landmarks, which is affordable precisely because step one cut the corpus
 *    to the handful of surfaces that could possibly answer.
 * 3. **Whether the relation holds.** Two rectangles. `beneath` is read off
 *    coordinates and is an observation; with no layout it is refused rather
 *    than guessed, because document order agrees with the screen often enough
 *    to be dangerous and not often enough to be relied on.
 *
 * The answer is a file and a line. That is the difference worth the whole
 * mechanism: every other tool here hands back an id to look something up with,
 * and somebody who asked where the warning is wanted the place it is written.
 */

/** One answer: a place on a surface, and where it is written. */
export interface Oriented {
  readonly subject: string;
  readonly example?: string;
  readonly anchor: Landmark;
  readonly target?: Landmark;
  /**
   * `false` when nothing in the relation said any of the target's words, and
   * the answer is *what is actually there* instead.
   *
   * The distinction a reader must be told, because the two are equally useful
   * and only one of them is a match. Somebody asking for **the warning** beneath
   * a field is naming it in the product's language, and a screen almost never
   * says `warning`: it says `role=status` and a sentence about a contract. The
   * project does not keep a table joining those, on the ground that a table is
   * declared rather than derived and rots with the first refactor — and that
   * whoever is asking already knows what a warning looks like. So the answer
   * shows the landmark and says it matched on place rather than on words.
   */
  readonly targetMatched: boolean;
  /** The other landmarks standing in the same relation, nearest first. */
  readonly alsoThere: readonly Landmark[];
  /** The landmarks enclosing the answer, outermost first. Where on the surface. */
  readonly within: readonly Landmark[];
  /** Pixels between the two, along the relation's axis. Absent without layout. */
  readonly apart?: number;
  readonly score: number;
}

export interface Orientation {
  readonly asked: Asked;
  readonly hits: readonly Oriented[];
  /** Surfaces the filter let through, before the exact walk. */
  readonly considered: number;
  readonly surfaces: number;
  readonly laidOut: boolean;
  /** The start point, when one was given, resolved. */
  readonly scope?: Scope;
  /** Component → declaring files, carried so an answer can print a place. */
  readonly declaredIn?: Readonly<Record<string, readonly string[]>>;
  /** Set when a spatial question met a reading with no layout. */
  readonly refused?: string;
}

/**
 * Where the thing asked about is.
 *
 * Ranking is integers only, and the keys are in the order somebody would argue
 * them: a surface where both the anchor and the target were found beats one
 * where only the anchor was, a rarer word beats a commoner one, a nearer
 * neighbour beats a further one, and the id breaks the tie so two machines
 * answering one question print one answer.
 */
export function orient(report: RunReport, question: string, from?: string): Orientation {
  const index = orientIndexOf(report);
  const scope = from === undefined ? undefined : scopeOf(report, from);
  // A boundary, not a preference: an empty scope is read empty rather than
  // widened back to the suite the caller narrowed away from.
  const within = scope === undefined ? undefined : scope.subjects;
  const asked = readQuestion(question);

  const anchorParts = asked.anchor.flatMap((word) => partsOf(word));
  const targetParts = asked.target.flatMap((word) => partsOf(word));

  const spatial = asked.relation !== undefined && asked.relation !== 'inside';
  if (spatial && !index.laidOut && index.surfaces > 0) {
    return {
      asked,
      hits: [],
      considered: 0,
      surfaces: index.surfaces,
      ...(scope === undefined ? {} : { scope }),
      laidOut: false,
      refused:
        'This run did not resolve layout, so no landmark carries a rectangle and nothing here ' +
        'knows what sits beneath what. Re-run under a profile with layout, or ask which ' +
        'surfaces hold both things without a relation between them.',
    };
  }

  // Step one. A subject that certainly says none of the anchor's words, or none
  // of the target's, cannot answer, and is dropped without its landmarks ever
  // being read.
  const survivors: number[] = [];
  for (let at = 0; at < index.rows.length; at += 1) {
    // The start point is step zero, ahead of the filters: it is exact where
    // they are probabilistic, so what it removes never has to be read at all.
    if (within !== undefined && !within.has(index.rows[at]!.subject)) continue;
    const filter = index.holds[at]!;
    // The anchor gates and the target does not. A surface that never says the
    // anchor's words cannot be the surface meant; a surface that never says
    // `warning` is most surfaces with a warning on them.
    if (anchorParts.length > 0 && !anchorParts.some((part) => filter.maybe(part))) continue;
    survivors.push(at);
  }

  // Rarity over the scope when there is one, for the reason `scopeOf` gives:
  // inside one area, the area's own words stop telling its surfaces apart. Both
  // halves of the fraction are recounted, never just the population — see
  // `holdersAmong`.
  const population = within === undefined ? index.surfaces : within.size;
  const holders =
    within === undefined
      ? index.holders
      : holdersAmong(index.rows.filter((row) => within.has(row.subject)));
  const rarity = (part: string): number =>
    Math.floor((1000 * (population - (holders.get(part) ?? 0) + 1)) / (population + 1));

  const hits: Oriented[] = [];
  for (const at of survivors) {
    const row = index.rows[at]!;
    const landmarks = row.landmarks ?? [];

    const candidates = anchors(landmarks, anchorParts, rarity);
    if (candidates.length === 0) continue;

    // The tail of a question names the anchor *and* the surface — "the carrier
    // field on the dispatch drawer" — and the surface's own container scores
    // just as well as the field does. Nothing but the relation separates them:
    // the drawer has nothing beneath it, because everything is inside it. So
    // the anchor is whichever candidate makes the question answerable, which
    // needs no grammar and no guess about which noun was the place.
    let anchor = candidates[0]!;
    let standing: readonly { at: number; score: number; apart?: number }[] = [];
    if (asked.relation !== undefined) {
      const answerable: {
        readonly candidate: { at: number; score: number };
        readonly found: readonly { at: number; score: number; apart?: number }[];
      }[] = [];
      for (const candidate of candidates) {
        const found = inRelation(landmarks, candidate.at, asked.relation, targetParts, rarity);
        if (found.length > 0) answerable.push({ candidate, found });
      }
      // A relation nothing stands in is a miss on this surface, whatever its
      // words said. That is the whole of the arrangement's contribution.
      if (answerable.length === 0) continue;

      // Of the ones that answer, the ones whose target matched on words answer
      // better; a relation satisfied by something that says none of them is the
      // fallback, not the competition.
      const named = answerable.filter(({ found }) => (found[0]?.score ?? 0) > 0);
      const pool = named.length === 0 ? answerable : named;
      pool.sort((left, right) => (right.found[0]?.score ?? 0) - (left.found[0]?.score ?? 0));

      // Two of them can both answer while one holds the other — the drawer and
      // the field on it, both with something beneath them. The enclosed one is
      // the thing the question named; see `deepestUnder`, which decides the
      // same way where there is no relation at all.
      const head = pool[0]!.candidate.at;
      const inside = deepestUnder(
        landmarks,
        pool.map(({ candidate }) => candidate),
        head,
      );
      const chosen = pool.find(({ candidate }) => candidate.at === inside) ?? pool[0]!;
      anchor = chosen.candidate;
      standing = chosen.found;
    } else {
      // With no relation the phrase still names the thing and what it sits in,
      // and nothing splits them — so containment does. See `deepestUnder`.
      const inside = deepestUnder(landmarks, candidates, anchor.at);
      if (inside !== anchor.at) anchor = { at: inside, score: anchor.score };
    }

    const found = standing[0];
    const landmark = found === undefined ? undefined : landmarks[found.at]!;
    hits.push({
      subject: row.subject,
      ...(row.terms.example?.[0] === undefined ? {} : { example: row.terms.example[0] }),
      anchor: landmarks[anchor.at]!,
      ...(landmark === undefined ? {} : { target: landmark }),
      targetMatched: (found?.score ?? 0) > 0,
      alsoThere: standing.slice(1, 1 + ALSO_SHOWN).map(({ at: index }) => landmarks[index]!),
      within: enclosing(landmarks, found?.at ?? anchor.at),
      ...(found?.apart === undefined ? {} : { apart: found.apart }),
      score: anchor.score + (found?.score ?? 0),
    });
  }

  hits.sort(
    (left, right) =>
      Number(right.targetMatched) - Number(left.targetMatched) ||
      Number(right.target !== undefined) - Number(left.target !== undefined) ||
      right.score - left.score ||
      (left.apart ?? 0) - (right.apart ?? 0) ||
      codeUnit(left.subject, right.subject),
  );

  return {
    asked,
    hits,
    considered: survivors.length,
    surfaces: index.surfaces,
    ...(scope === undefined ? {} : { scope }),
    laidOut: index.laidOut,
    declaredIn: report.lexicon?.declaredIn ?? {},
  };
}

/** How many landmarks are tried as the anchor before the surface is given up on. */
const ANCHORS_TRIED = 8;

/**
 * The landmarks a phrase might be naming, best first.
 *
 * Worth is how many of the phrase's words each says, weighted by how few other
 * surfaces say them — `carrier` on a shipping suite is worth more than `field`,
 * which nearly everything says. A name is worth more than a sentence, because a
 * paragraph mentioning the carrier is not the carrier field.
 *
 * Among equal words the smaller one wins. The same rule the census uses to pick
 * a narrow example, for the same reason: a dialog and the field on it both
 * answer to the dialog's name, and the one somebody pointing means is the
 * smaller.
 *
 * A phrase names the thing *and* what it sits in — *the Assignee warning on the
 * create issue dialog* — so the enclosing landmark says every word the enclosed
 * one does and ties with it. A run without rectangles has no size to separate
 * them and document order then hands back the container, which is never what
 * was meant. Depth is the size that needs no layout: of two landmarks saying
 * the same words, the deeper one is inside the other, and the deeper one is the
 * answer.
 */
export function anchors(
  landmarks: readonly Landmark[],
  parts: readonly string[],
  rarity: (part: string) => number,
): readonly { at: number; score: number }[] {
  if (parts.length === 0) return [];
  const scored: { at: number; score: number; size: number; depth: number }[] = [];

  for (let at = 0; at < landmarks.length; at += 1) {
    const score = scoreOf(landmarks[at]!, parts, rarity);
    if (score === 0) continue;
    const box = landmarks[at]!.box;
    scored.push({
      at,
      score,
      size: box === undefined ? 0 : box[2] * box[3],
      depth: enclosing(landmarks, at).length,
    });
  }

  scored.sort(
    (left, right) =>
      right.score - left.score ||
      left.size - right.size ||
      right.depth - left.depth ||
      left.at - right.at,
  );
  return scored.slice(0, ANCHORS_TRIED).map(({ at, score }) => ({ at, score }));
}

const NAME_WEIGHT = 4;
const TEXT_WEIGHT = 3;
const ROLE_WEIGHT = 2;
const HANDLE_WEIGHT = 4;

function scoreOf(
  landmark: Landmark,
  parts: readonly string[],
  rarity: (part: string) => number,
): number {
  let score = 0;
  for (const part of parts) {
    const weight =
      matches(landmark.name, part) ? NAME_WEIGHT
      : matches(landmark.handle, part) ? HANDLE_WEIGHT
      : matches(landmark.text, part) ? TEXT_WEIGHT
      : matches(landmark.role, part) ? ROLE_WEIGHT
      : 0;
    if (weight !== 0) score += weight * rarity(part);
  }
  return score;
}

/** Exactly, or by a prefix of three characters or more. The rule `locate` uses. */
function matches(value: string | undefined, part: string): boolean {
  if (value === undefined) return false;
  for (const token of tokensOf(value)) {
    if (token === part) return true;
    if (part.length >= 3 && token.startsWith(part)) return true;
    if (token.length >= 3 && part.startsWith(token)) return true;
  }
  return false;
}

/** How far a candidate is along the relation's axis, or `undefined` if it is not there. */
function apartOn(relation: Relation, anchor: Landmark, candidate: Landmark): number | undefined {
  if (relation === 'inside') return undefined;
  const one = anchor.box;
  const other = candidate.box;
  if (one === undefined || other === undefined) return undefined;

  const [ax, ay, aw, ah] = one;
  const [bx, by, bw, bh] = other;
  // A few pixels of slack, because a border and a margin are not a disagreement
  // about which of two things is on top.
  const slack = 4;

  if (relation === 'beneath' || relation === 'above') {
    const overlaps = bx < ax + aw && ax < bx + bw;
    if (!overlaps) return undefined;
    const gap = relation === 'beneath' ? by - (ay + ah) : ay - (by + bh);
    return gap >= -slack ? Math.max(gap, 0) : undefined;
  }

  if (relation === 'right of' || relation === 'left of') {
    const overlaps = by < ay + ah && ay < by + bh;
    if (!overlaps) return undefined;
    const gap = relation === 'right of' ? bx - (ax + aw) : ax - (bx + bw);
    return gap >= -slack ? Math.max(gap, 0) : undefined;
  }

  // Beside: any direction, measured between centres, so "near the carrier
  // field" does not silently mean "below it".
  return Math.abs(bx + (bw >> 1) - (ax + (aw >> 1))) + Math.abs(by + (bh >> 1) - (ay + (ah >> 1)));
}

/** How many other landmarks in the relation an answer shows beside its best. */
const ALSO_SHOWN = 3;

/**
 * Every landmark standing in the relation, best first.
 *
 * Sorted by words then by nearness, and *not* filtered by words. A candidate
 * scoring nothing still belongs here: when the question names something in the
 * product's language that no screen spells out, what is actually beneath the
 * field is the answer, and the caller is told it matched on place rather than
 * on words. A landmark enclosing the anchor is excluded — the dialog is
 * technically above and below everything on it, and saying so answers nothing.
 */
function inRelation(
  landmarks: readonly Landmark[],
  anchorAt: number,
  relation: Relation,
  parts: readonly string[],
  rarity: (part: string) => number,
): readonly { at: number; score: number; apart?: number }[] {
  const anchor = landmarks[anchorAt]!;
  const standing: { at: number; score: number; apart?: number }[] = [];

  for (let at = 0; at < landmarks.length; at += 1) {
    if (at === anchorAt) continue;
    if (enclosedBy(landmarks, anchorAt, at)) continue;

    let apart: number | undefined;
    if (relation === 'inside') {
      if (!enclosedBy(landmarks, at, anchorAt)) continue;
    } else {
      apart = apartOn(relation, anchor, landmarks[at]!);
      if (apart === undefined) continue;
    }

    standing.push({ at, score: scoreOf(landmarks[at]!, parts, rarity), ...(apart === undefined ? {} : { apart }) });
  }

  // A better word beats a nearer neighbour: a paragraph four pixels below the
  // field is not the warning if the warning is forty pixels below it. Among
  // equal words, nearer wins, which is what *underneath* means when nothing
  // distinguishes two things but distance.
  standing.sort((left, right) => right.score - left.score || (left.apart ?? 0) - (right.apart ?? 0) || left.at - right.at);
  return standing;
}
