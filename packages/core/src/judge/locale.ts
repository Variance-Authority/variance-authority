import type { NodePath, SemanticNode, SemanticSnapshot } from '../format/snapshot.js';
import { locate } from '../attribute/locate.js';
import type { Finding } from './inspect.js';

/**
 * One subject, two locales.
 *
 * The join a pixel differ cannot make. A baseline image and a message catalogue
 * have nothing in common — there is no key that relates the string `checkout.cta`
 * to a region of a PNG — so every product in the category answers a locale
 * question by taking N times as many screenshots and asking a human to look at
 * all of them. The document has the strings *and* the boxes, addressed to the
 * same nodes, so the two questions a localized UI actually raises are arithmetic:
 *
 * 1. **Did this string get translated?** Identical text in two locales, in a
 *    subject where other text did change.
 * 2. **Did the translation break the layout?** A box that fits its container in
 *    one locale and overflows it in another.
 *
 * **This is not a regression comparison and must not be read as one.** Both
 * renders are correct. `diffSnapshots` answers "did this change since the
 * baseline"; this answers "do these two agree about everything except their
 * language", which is a different question with a different failure mode. So it
 * produces `Finding`s — the same type inspection produces, for the same reason:
 * a defect in a render, not a change to one.
 *
 * **What is deliberately not here.** No expansion threshold. "German is 35%
 * longer" is a rule of thumb, and a tool that fails a build on a ratio is a tool
 * whose ratio gets raised until it stops failing. The growth is *measured* and
 * returned; only overflow — a box outside the box that contains it, which is a
 * fact about two rectangles — is a finding.
 */

export interface LocaleComparison {
  readonly subject: string;
  /** Whatever the caller calls the two renders. This module reads no locale tags. */
  readonly base: string;
  readonly other: string;

  /** Text nodes that differ. Evidence that translation happened at all. */
  readonly translated: number;
  /** Text nodes carrying letters that are byte-identical in both. */
  readonly identical: number;

  readonly findings: readonly Finding[];

  /**
   * The largest width growth observed, when both sides carried layout.
   *
   * Reported, never judged. A reviewer deciding whether a locale is safe wants
   * the number and the component; a build deciding it from a threshold wants an
   * argument nobody has made.
   */
  readonly expansion?: {
    readonly ratio: number;
    readonly path: NodePath;
    readonly component?: string;
  };

  /**
   * `false` when either side lacked rects, so overflow could not be decided.
   *
   * The same rule as `unobserved`: a question that was not asked has no answer,
   * and "no overflow findings" must not be readable as "nothing overflows" when
   * the profile had no layout engine.
   */
  readonly layoutObserved: boolean;

  /**
   * What the two trees did not have in common, and therefore what was not asked.
   *
   * {@link pairByPosition} refuses to guess across a structural difference: a
   * node whose tag moved takes its whole subtree out of the comparison, and
   * children past the shorter of the two lists are never reached. Both are the
   * right call — a plural form with an extra element is not evidence about
   * translation — and both make this function return **fewer findings**, which
   * is the one direction a partial answer must never be reported in silently.
   *
   * A German plural that adds a `<span>`, or a locale whose date renders as
   * `<time>` where English renders `<span>`, drops real strings out of the
   * comparison. Without this field the run looks *cleaner* for it: zero
   * untranslated strings, because zero strings were examined.
   *
   * Always present, never absent when the trees agree. `{ base: 0, other: 0 }`
   * says the trees were walked and matched; a missing field would say nobody
   * counted, and those are the two things this project exists to keep apart.
   */
  readonly uncompared: Uncompared;
}

export interface Uncompared {
  /** Nodes in the base render that nothing in the other render was paired with. */
  readonly base: number;
  /** Nodes in the other render that nothing in the base render was paired with. */
  readonly other: number;

  /**
   * Where pairing stopped, as paths in the *base* render, in document order.
   *
   * A count says the answer is partial; a path says where to look. Reported in
   * the base render's addresses because that is the side a reader has a
   * baseline for — the other locale's paths past a divergence are addresses in
   * a tree nothing here compared.
   */
  readonly divergedAt: readonly NodePath[];
}

export interface LocaleOptions {
  /**
   * Slack in pixels before a box counts as outside its container.
   *
   * Not a tolerance on the finding — a tolerance on *rounding*. Sub-pixel layout
   * routinely puts a child a fraction outside its parent's rounded rect, and
   * reporting that as overflow would bury the real ones.
   */
  readonly slack?: number;
}

/** Has at least one letter. `€ 2,400.00` and `—` are not strings anyone translates. */
const TRANSLATABLE = /\p{L}/u;

/**
 * Attributes that carry prose, and are therefore translated.
 *
 * The list matters more than it looks. The first run of this against a real
 * panel found **nothing**, because the only untranslated string in the fixture
 * was a `title` — and the rule was reading text nodes only. In a real product
 * the strings most often left behind are exactly these: an `aria-label` on an
 * icon button, a `placeholder`, an `alt`. They render no pixel of their own,
 * which is why they are forgotten, and why no image comparison at any tolerance
 * has ever reported one.
 */
const TRANSLATABLE_ATTRIBUTES = ['title', 'alt', 'placeholder'] as const;

export function compareLocales(
  base: SemanticSnapshot,
  other: SemanticSnapshot,
  labels: { readonly base: string; readonly other: string },
  options: LocaleOptions = {},
): LocaleComparison {
  if (base.subject.id !== other.subject.id) {
    throw new Error(
      `refusing to compare locales of different subjects: ${base.subject.id} vs ${other.subject.id}`,
    );
  }

  const slack = options.slack ?? 1;
  const { pairs, uncompared } = pairByPosition(base.root, other.root);

  const findings: Finding[] = [];
  const identical: { node: SemanticNode; text: string; what: string }[] = [];
  let translated = 0;
  let layoutObserved = false;
  let expansion: LocaleComparison['expansion'];

  for (const { before, after, container } of pairs) {
    // Text, then the accessible name and description, then the prose-bearing
    // attributes. All four are strings a translator is handed and all four are
    // invisible to a camera in different ways: a name is announced and never
    // painted, a `title` appears only on hover, an `alt` only when the image
    // does not load.
    for (const [what, was, is] of stringsOf(before, after)) {
      if (was !== is) {
        translated += 1;
      } else if (TRANSLATABLE.test(is)) {
        identical.push({ node: after, text: is, what });
      }
    }

    if (before.rect === undefined || after.rect === undefined) continue;
    layoutObserved = true;

    if (before.rect.width > 0) {
      const ratio = after.rect.width / before.rect.width;
      if (expansion === undefined || ratio > expansion.ratio) {
        expansion = { ratio, path: after.path, ...component(after) };
      }
    }

    // Overflow is judged in the *other* locale against this node's container
    // there, and only where the base render fitted. A layout that was already
    // broken is a real problem and is not this one: reporting it would put a
    // pre-existing bug in front of whoever is reviewing a translation, in every
    // locale, every time.
    if (container === undefined) continue;

    const outsideNow = after.rect.x + after.rect.width;
    const insideNow = container.after.rect!.x + container.after.rect!.width;
    const outsideBefore = before.rect.x + before.rect.width;
    const insideBefore = container.before.rect!.x + container.before.rect!.width;

    if (outsideNow > insideNow + slack && outsideBefore <= insideBefore + slack) {
      findings.push(
        finding(
          'overflows-container',
          'geometry',
          after,
          other,
          `${describe(after)} is ${Math.round(outsideNow - insideNow)}px wider than what ` +
            `contains it in ${labels.other}, and fitted in ${labels.base}`,
        ),
      );
    }
  }

  // Only when something *was* translated. A subject rendered twice in one
  // language has every string identical, and reporting all of them as
  // untranslated would be a tool telling the truth about nothing.
  if (translated > 0) {
    // One node, one string, one finding. An icon button's `title` and its
    // accessible name are routinely the same string, and reporting both is
    // reporting one missing translation twice — the same collapse the
    // name-from-content check makes above, at the other end.
    for (const { node, text, what } of collapse(identical)) {
      findings.push(
        finding(
          'untranslated',
          'content',
          node,
          other,
          `${what} "${clip(text)}" is identical in ${labels.base} and ${labels.other} — ` +
            'either it was not translated, or it is a name that does not change',
        ),
      );
    }
  }

  return {
    subject: other.subject.id,
    base: labels.base,
    other: labels.other,
    translated,
    identical: identical.length,
    findings,
    ...(expansion !== undefined ? { expansion } : {}),
    layoutObserved,
    uncompared,
  };
}

/**
 * Every string on a node, paired across the two renders, labelled by where it
 * came from so the finding can say *which* string rather than only its value.
 *
 * A string present on one side and absent on the other is skipped rather than
 * counted as translated. That is a structural difference between the renders,
 * which is what `pairByPosition` refuses to guess about, and counting it here
 * would smuggle the guess back in through a different door.
 */
/**
 * One entry per (node, value). Where several fields carry the same string, they
 * are named together: `accessible name / title=` says more than either alone and
 * is still one thing to fix.
 */
function collapse(
  candidates: readonly { node: SemanticNode; text: string; what: string }[],
): readonly { node: SemanticNode; text: string; what: string }[] {
  const byValue = new Map<string, { node: SemanticNode; text: string; whats: string[] }>();

  for (const candidate of candidates) {
    const key = `${candidate.node.path}\u0000${candidate.text}`;
    const seen = byValue.get(key);
    if (seen) seen.whats.push(candidate.what);
    else byValue.set(key, { node: candidate.node, text: candidate.text, whats: [candidate.what] });
  }

  return [...byValue.values()].map(({ node, text, whats }) => ({
    node,
    text,
    what: whats.join(' / '),
  }));
}

function stringsOf(
  before: SemanticNode,
  after: SemanticNode,
): readonly (readonly [what: string, was: string, is: string])[] {
  const strings: (readonly [string, string, string])[] = [];

  const pair = (what: string, was: string | undefined, is: string | undefined): void => {
    if (was !== undefined && is !== undefined) strings.push([what, was, is]);
  };

  pair('text', before.text, after.text);

  // A name computed from content *is* the text, observed a second way. Counting
  // both makes one translated string read as two, and one missing translation
  // read as two findings on one node. Same rule as `derivedFrom` on a delta.
  if (before.name !== before.text || after.name !== after.text) {
    pair('accessible name', before.name, after.name);
  }
  pair('accessible description', before.description, after.description);
  for (const attribute of TRANSLATABLE_ATTRIBUTES) {
    pair(`${attribute}=`, before.attributes[attribute], after.attributes[attribute]);
  }

  return strings;
}

function finding(
  rule: 'untranslated' | 'overflows-container',
  band: Finding['band'],
  node: SemanticNode,
  snapshot: SemanticSnapshot,
  what: string,
): Finding {
  const where = locate(snapshot.root, node.path).where;

  return {
    rule,
    band,
    path: node.path,
    what,
    ...(where !== '' ? { where } : {}),
    ...component(node),
    ...(node.provenance ? { owners: node.provenance.owners } : {}),
  };
}

/**
 * A text node has no provenance of its own — React does not own text — so the
 * name comes from the nearest owner recorded on it, and the caller's tree walk
 * has already put the enclosing component there.
 */
function component(node: SemanticNode): { component?: string } {
  const name = node.provenance?.createdBy ?? node.provenance?.owners[0]?.name;
  return name === undefined ? {} : { component: name };
}

function describe(node: SemanticNode): string {
  if (node.name !== undefined) return `${node.role ?? node.tag} "${clip(node.name)}"`;
  if (node.text !== undefined) return `"${clip(node.text)}"`;
  return `<${node.tag}>`;
}

function clip(text: string): string {
  return text.length <= 40 ? text : `${text.slice(0, 39)}…`;
}

interface Pair {
  readonly before: SemanticNode;
  readonly after: SemanticNode;
  /** The enclosing pair, when both sides have one *and* both carry rects. */
  readonly container?: Pair;
}

/**
 * Pair the two trees by position, not by identity — and this is the whole reason
 * `matchTrees` is not reused here.
 *
 * `matchKey` keys a node on its role and accessible name, because that is the
 * strongest signal that two renders of one revision are showing the same thing.
 * A translation changes exactly that: `button "Continue"` and
 * `button "Fortfahren"` get different keys, so the differ reports the button as
 * removed and a different one added, and every comparison this module wants to
 * make evaporates. It is the right key for "same language, later revision" and
 * the wrong one for "same revision, another language".
 *
 * Position is the right key here because a translation is not supposed to change
 * the tree. Where the shapes diverge — a locale that wraps to two lines with an
 * extra element, a plural form with a different structure — pairing stops at
 * that branch rather than guessing, and the strings underneath it are simply not
 * compared. Under-reporting, which is the direction to fail in for a report that
 * does not block anything.
 *
 * **Under-reporting is only the safe direction while it is counted.** Silent, it
 * is the failure this whole project refuses, wearing the most convincing
 * disguise available: a subject whose tree diverged reports *fewer* untranslated
 * strings than one that matched, so the locale nobody translated reads as the
 * clean one. So every node the walk did not reach is counted, and every branch
 * it stopped at is named.
 */
function pairByPosition(
  base: SemanticNode,
  other: SemanticNode,
): { readonly pairs: readonly Pair[]; readonly uncompared: Uncompared } {
  const pairs: Pair[] = [];
  const divergedAt: NodePath[] = [];

  const walk = (before: SemanticNode, after: SemanticNode, container?: Pair): void => {
    if (before.tag !== after.tag) {
      // This node and everything under it, on both sides. Recorded at the node
      // that stopped the walk rather than at each of its descendants: one
      // address a reader can open beats a list of addresses in a subtree that
      // was never examined.
      divergedAt.push(before.path);
      return;
    }

    const pair: Pair = {
      before,
      after,
      ...(container !== undefined && container.before.rect !== undefined &&
      container.after.rect !== undefined
        ? { container }
        : {}),
    };
    pairs.push(pair);

    const count = Math.min(before.children.length, after.children.length);
    // The parent, because the unreached children are the ones the *shorter*
    // list does not have — on whichever side that is, they have no counterpart
    // to be addressed by.
    if (before.children.length !== after.children.length) divergedAt.push(before.path);

    for (let index = 0; index < count; index += 1) {
      walk(before.children[index]!, after.children[index]!, pair);
    }
  };

  walk(base, other);

  // Total minus paired, per side. A pair consumes exactly one node from each, so
  // the two subtractions are independent and a lopsided divergence says which
  // render carried the extra material.
  return {
    pairs,
    uncompared: {
      base: countNodes(base) - pairs.length,
      other: countNodes(other) - pairs.length,
      divergedAt,
    },
  };
}

function countNodes(node: SemanticNode): number {
  let total = 1;
  for (const child of node.children) total += countNodes(child);
  return total;
}
