import { structuralComponents, type SubjectComposition } from './composition.js';
import { attributed } from './instances.js';

/**
 * Each subject read as the narrower subjects inside it.
 *
 * The same algebra the recording answers for a test, over renderings instead
 * of regions. A subject's footprint is the distinct renderings it holds — a
 * component and the digest of what it rendered — less structure, the
 * components more than half the suite mounts. A piece is a smaller subject with
 * at least nine tenths of its footprint inside this one: the chip story inside
 * the footer story inside the page. A whole is a larger subject holding at
 * least nine tenths of this one. A subject with exactly the same footprint is
 * alike, and is neither.
 *
 * What no piece renders is the residue, counted rendering by rendering and
 * never as a difference of totals. It splits in two. A component no piece
 * mounts is the subject's own: only it shows that component, so only it can
 * catch a change there. A component a piece mounts, rendered here in a way the
 * piece never renders it, is the component in context — the narrow subject
 * does not watch this rendering, and a change to it is the page's to catch.
 *
 * It decides nothing. A subject whose pieces explain all of it is not therefore
 * redundant: the bytes a page holds are the bytes its pieces hold, and the
 * arrangement between them is not a rendering of any one component.
 */

/** A piece holds at least this share of its own footprint inside the subject; a whole holds at least this share of the subject's. */
const HOLDS = 0.9;

/** Another subject beside the one read. */
export interface SubjectShare {
  readonly subject: string;
  /** Its footprint: distinct renderings outside structure. */
  readonly footprint: number;
  /** Renderings of the subject read that it holds too. */
  readonly shared: number;
}

/** Renderings of one component that no piece holds. */
export interface Residue {
  readonly component: string;
  readonly renderings: number;
  /** The pieces that mount the component and render it otherwise. Absent on a component no piece mounts. */
  readonly pieces?: readonly string[];
}

export interface SubjectPieces {
  /** Distinct renderings it holds outside structure. */
  readonly footprint: number;
  /** Structural components it mounts. */
  readonly structure: number;
  /** Subjects whose footprint is exactly its own, in plan order. */
  readonly alike: readonly string[];
  /** Smaller subjects inside it, most shared first. */
  readonly pieces: readonly SubjectShare[];
  /** Larger subjects holding it, smallest first. */
  readonly wholes: readonly SubjectShare[];
  /** Renderings of its footprint some piece holds. */
  readonly explained: number;
  /** Residue in components no piece mounts, by component name. */
  readonly own: readonly Residue[];
  /** Residue in components a piece mounts and renders otherwise, by component name. */
  readonly inContext: readonly Residue[];
}

/** Every subject's pieces, keyed by subject. A pure fold over the suite, so it reads the same however the run was scheduled. */
export function piecesOf(subjects: readonly SubjectComposition[]): ReadonlyMap<string, SubjectPieces> {
  const structural = structuralComponents(subjects);
  const footprints = new Map<string, ReadonlySet<string>>();
  const mounted = new Map<string, ReadonlySet<string>>();
  const structure = new Map<string, number>();
  const holders = new Map<string, string[]>();
  for (const { subject, instances } of subjects) {
    const held = new Set<string>();
    const components = new Set<string>();
    const frame = new Set<string>();
    for (const instance of instances) {
      if (!attributed(instance)) continue;
      if (structural.has(instance.component)) {
        frame.add(instance.component);
        continue;
      }
      held.add(keyOf(instance.component, instance.rendering));
      components.add(instance.component);
    }
    footprints.set(subject, held);
    mounted.set(subject, components);
    structure.set(subject, frame.size);
    for (const key of held) {
      const list = holders.get(key);
      if (list === undefined) holders.set(key, [subject]);
      else list.push(subject);
    }
  }

  const order = new Map(subjects.map(({ subject }, at) => [subject, at]));
  const answers = new Map<string, SubjectPieces>();
  for (const { subject } of subjects) {
    const mine = footprints.get(subject) ?? new Set<string>();
    const size = mine.size;
    const shared = new Map<string, number>();
    for (const key of mine) {
      for (const other of holders.get(key) ?? []) {
        if (other !== subject) shared.set(other, (shared.get(other) ?? 0) + 1);
      }
    }
    const pieces: SubjectShare[] = [];
    const wholes: SubjectShare[] = [];
    const alike: string[] = [];
    for (const [other, with_] of shared) {
      const theirs = footprints.get(other)?.size ?? 0;
      const share = { subject: other, footprint: theirs, shared: with_ };
      if (theirs < size && with_ >= HOLDS * theirs) pieces.push(share);
      else if (theirs > size && with_ >= HOLDS * size) wholes.push(share);
      else if (theirs === size && with_ === size) alike.push(other);
    }
    const planned = (a: SubjectShare, b: SubjectShare) => (order.get(a.subject) ?? 0) - (order.get(b.subject) ?? 0);
    pieces.sort((a, b) => b.shared - a.shared || b.footprint - a.footprint || planned(a, b));
    wholes.sort((a, b) => a.footprint - b.footprint || planned(a, b));
    alike.sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

    const kept = new Set(pieces.map((piece) => piece.subject));
    let explained = 0;
    const left = new Map<string, number>();
    for (const key of mine) {
      if ((holders.get(key) ?? []).some((other) => kept.has(other))) explained += 1;
      else {
        const component = componentOf(key);
        left.set(component, (left.get(component) ?? 0) + 1);
      }
    }
    const own: Residue[] = [];
    const inContext: Residue[] = [];
    for (const component of [...left.keys()].sort(byCodeUnit)) {
      const renderings = left.get(component) ?? 0;
      const by = pieces.map((piece) => piece.subject).filter((piece) => mounted.get(piece)?.has(component) === true);
      if (by.length === 0) own.push({ component, renderings });
      else inContext.push({ component, renderings, pieces: by });
    }
    answers.set(subject, { footprint: size, structure: structure.get(subject) ?? 0, alike, pieces, wholes, explained, own, inContext });
  }
  return answers;
}

/** A component and a rendering, joined by a character no component name holds. */
function keyOf(component: string, rendering: string): string {
  return `${component}\u0000${rendering}`;
}

function componentOf(key: string): string {
  return key.slice(0, key.indexOf('\u0000'));
}

/** Code-unit order, never `localeCompare`, as `composition.ts` sorts. */
function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
