import type { SemanticNode } from '../format/snapshot.js';
import { UNATTRIBUTED } from './boundary.js';

/**
 * Where each thing on a subject was, kept as the run read it.
 *
 * The bags next door say what a subject holds; these say where it held it, off
 * the same walk over the same tree, because two walks eventually disagree about
 * what was there. A node earns a place by bearing a role, an accessible name,
 * or words of its own — never by what it is called — so a screen written under
 * an era's worth of higher-order components reduces to the same landmarks as
 * the same screen written flat.
 */

/** One thing on a subject a person could point at, where the run saw it. */
export interface Landmark {
  /** Accessible role, when the reading resolved one. */
  readonly role?: string;
  /** Accessible name — what a screen reader would announce. */
  readonly name?: string;
  /**
   * The words directly inside it, and only those. Text belonging to a nested
   * landmark stays on that landmark, so a container does not inherit the page.
   */
  readonly text?: string;
  /** Index of the nearest enclosing landmark. Absent on a top-level one. */
  readonly within?: number;
  /**
   * `[x, y, width, height]` in layout pixels, integers.
   *
   * Absent, never zeroed, exactly as `rect` is: a reading that did not resolve
   * layout has no opinion about what sits beneath what, and must say so rather
   * than answer from document order while sounding equally sure.
   */
  readonly box?: readonly [number, number, number, number];
  /** Where the element was written, when the project installed the plugin. */
  readonly file?: string;
  readonly line?: number;
  /**
   * The innermost component that owns it, off the fiber's owner chain.
   *
   * The line an element was written at needs the JSX-source plugin, which a
   * production build strips — and a built Storybook is one, so `file` and
   * `line` are absent on exactly the runs that matter most. The owner chain
   * survives that build: not the line, but the component whose source you would
   * open, joined to a path through `LexiconReport.declaredIn`.
   */
  readonly component?: string;
  /** The component whose JSX created it. The unit somebody owns. */
  readonly createdBy?: string;
  /** A test handle, when one was set. The one name a suite chose deliberately. */
  readonly handle?: string;
}

/**
 * Landmarks kept per subject.
 *
 * Higher than the cap above on purpose. A field that loses its two hundredth
 * distinct value loses a word the subject also says somewhere else; a subject
 * that loses its last landmark loses a *place*, and a place has no second
 * spelling.
 *
 * Four hundred was a guess and a 572-subject application falsified it: p50 9,
 * p90 52, p99 227, and four subjects pinned at the cap, losing 1,973 places
 * between them off screens of roughly 1,179, 926, 836 and 632. Those four are
 * its biggest screens, which are the ones somebody most needs orienting on, and
 * what a cap cuts there is the bottom of the page. Twelve hundred clears the
 * largest with room and leaves the other 539 an order of magnitude below it.
 */
export const LANDMARK_CAP = 1_200;

/** A digest is a coordinate, not a word: matching one matches a hash. */
export function isDigest(value: string): boolean {
  return /^v\d+:[0-9a-f]+$/.test(value);
}

/**
 * Document order, carrying what encloses what.
 *
 * `visit` returns the index a child should call its enclosure, which is how
 * containment survives a tree whose intermediate nodes are nearly all
 * scaffolding: a landmark's `within` names the nearest *landmark* above it, not
 * the nearest node, so the depth of the wrapper stack between them costs
 * nothing.
 */
export function walk(
  node: SemanticNode,
  within: number | undefined,
  visit: (node: SemanticNode, within: number | undefined) => number | undefined,
): void {
  const at = visit(node, within);
  for (const child of node.children) walk(child, at, visit);
}

/**
 * The landmark this node earns, or nothing.
 *
 * The test is what the node says. A text node's words belong to the element
 * holding them, which was visited first and has already taken them — visited
 * all the same, because the `text` bag is indexed from exactly these.
 */
export function landmarkFor(node: SemanticNode, within: number | undefined): Landmark | undefined {
  if (node.tag === '#text') return undefined;
  const text = ownTextOf(node);
  const name = node.name ?? node.description ?? labelOf(node);
  if (node.role === undefined && name === undefined && text === undefined) return undefined;
  return landmarkOf(node, text, name, within);
}

function landmarkOf(
  node: SemanticNode,
  text: string | undefined,
  name: string | undefined,
  within: number | undefined,
): Landmark {
  const source = node.provenance?.source;
  const handle = node.attributes['data-testid'] ?? node.attributes['data-test-id'];
  // `owners[0]` is the innermost frame: the component that rendered this node,
  // not the one it was placed by. That is the file somebody opens.
  const component = node.provenance?.owners?.[0]?.name;

  return {
    ...(node.role === undefined ? {} : { role: node.role }),
    ...(name === undefined ? {} : { name }),
    ...(text === undefined ? {} : { text }),
    ...(within === undefined ? {} : { within }),
    ...(node.rect === undefined
      ? {}
      : {
          box: [
            Math.round(node.rect.x),
            Math.round(node.rect.y),
            Math.round(node.rect.width),
            Math.round(node.rect.height),
          ] as const,
        }),
    ...(source === undefined ? {} : { file: source.file, line: source.line }),
    ...(component === undefined || component === UNATTRIBUTED ? {} : { component }),
    ...(node.provenance?.createdBy === undefined ? {} : { createdBy: node.provenance.createdBy }),
    ...(handle === undefined ? {} : { handle }),
  };
}

/**
 * The words this node says itself.
 *
 * Direct text children only. A container does not inherit the sentence its
 * button holds, because the question a landmark answers is *where does this
 * sentence live*, and an answer that says "on the page" is not one.
 */
function ownTextOf(node: SemanticNode): string | undefined {
  let held = '';
  for (const child of node.children) {
    if (child.tag !== '#text') continue;
    const text = child.text;
    if (text === undefined || isDigest(text)) continue;
    held = held === '' ? text : `${held} ${text}`;
  }
  const trimmed = held.replace(/\s+/g, ' ').trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * A name for a node that resolved none, from the attributes that are a label
 * for a person rather than a value for a machine. The same three `names` reads.
 */
function labelOf(node: SemanticNode): string | undefined {
  const held = node.attributes['placeholder'] ?? node.attributes['alt'] ?? node.attributes['title'];
  if (held === undefined) return undefined;
  const trimmed = held.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * Which landmarks survive a subject that overran the cap.
 *
 * Words first: a landmark with a name or a sentence is one a question can
 * reach, and a bare `generic` with a rectangle is one nothing will ever ask
 * for. Ties keep document order, so what survives is still an arrangement.
 * `within` is rewritten to the nearest surviving enclosure, because an index
 * into a list that has been cut is otherwise a pointer at the wrong thing.
 */
export function capLandmarks(landmarks: readonly Landmark[]): readonly Landmark[] {
  const worth = (landmark: Landmark): number =>
    (landmark.name === undefined ? 0 : 2) + (landmark.text === undefined ? 0 : 1);

  const keep = landmarks
    .map((landmark, at) => ({ landmark, at }))
    .sort((left, right) => worth(right.landmark) - worth(left.landmark) || left.at - right.at)
    .slice(0, LANDMARK_CAP)
    .sort((left, right) => left.at - right.at);

  const moved = new Map<number, number>();
  keep.forEach(({ at }, to) => moved.set(at, to));

  const enclosure = (at: number | undefined): number | undefined => {
    let held = at;
    while (held !== undefined) {
      const to = moved.get(held);
      if (to !== undefined) return to;
      held = landmarks[held]?.within;
    }
    return undefined;
  };

  return keep.map(({ landmark }) => {
    const within = enclosure(landmark.within);
    const { within: _dropped, ...rest } = landmark;
    return within === undefined ? rest : { ...rest, within };
  });
}
