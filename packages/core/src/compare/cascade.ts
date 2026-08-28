import { digestValue, type Digest } from '../format/hash.js';
import type { SemanticNode, SemanticSnapshot, StyleProvenanceEntry } from '../format/snapshot.js';
import type { MovedInput } from './parting.js';

/**
 * The input nobody passes.
 *
 * Every rung in `parting.ts` above this one reads something a boundary
 * *received* — a prop, a context, a hook cell — and all three arrive through a
 * framework adapter. This one reads what the boundary did not receive and did
 * not declare, out of the snapshot itself, which is why it is the only rung a
 * run with no adapter attached can reach.
 */

/**
 * Every property some declaration set *at* a node, keyed by node and name.
 *
 * `styleProvenance` records where each winning declaration came from, so the
 * properties it does not mention at a node are exactly the ones that arrived
 * from somewhere else — which is the whole reading below.
 */
export function declaredIn(snapshot: SemanticSnapshot): ReadonlySet<string> {
  return new Set(snapshot.styleProvenance.map(keyOf));
}

function keyOf(entry: StyleProvenanceEntry): string {
  return `${entry.path}\u0000${entry.property}`;
}

/**
 * What an ancestor decided, and the rung that stops this being called a flake.
 *
 * A component that sets its own font and no colour paints white on a dark panel
 * and near-black on a light card from one set of props. Every input the holding
 * carries — props, contexts, hook cells — is byte-identical across the two, so
 * before this existed the boundary settled at `undetermined` and `explainParting`
 * called a perfectly deterministic component *nondeterministic*. That is the
 * accusation ADR-0002 forbids making about an input nobody read, and the input
 * was there to be read: the resolved value is on the node and `styleProvenance`
 * says no declaration here produced it.
 *
 * So the reading is the difference between those two facts — **in the style,
 * not in the provenance** — and a property that differs on that test came from
 * an ancestor's cascade. It ranks with `handed` and `provided` because it says
 * the same thing they do: the cause is above this boundary, not in it.
 *
 * Values are digested rather than carried, so that every `MovedInput` means one
 * thing regardless of kind. The property name is the part a reader acts on, and
 * the deltas already name what it turned into on the page.
 *
 * Unpaired boundaries contribute nothing: a component present on one side only
 * has not inherited differently, it has not been compared.
 */
export function cascadeInputs(
  left: SemanticNode | undefined,
  right: SemanticNode,
  there: ReadonlySet<string>,
  here: ReadonlySet<string>,
): readonly MovedInput[] {
  if (left === undefined) return [];

  const before = inheritedAt(left, there);
  const after = inheritedAt(right, here);
  const moved: MovedInput[] = [];

  for (const name of [...new Set([...before.keys(), ...after.keys()])].sort()) {
    const from = before.get(name);
    const to = after.get(name);
    if (from !== to) moved.push({ kind: 'inherited', name, from, to });
  }

  return moved;
}

function inheritedAt(node: SemanticNode, declared: ReadonlySet<string>): Map<string, Digest> {
  const found = new Map<string, Digest>();
  for (const [property, value] of Object.entries(node.style)) {
    if (declared.has(`${node.path}\u0000${property}`)) continue;
    found.set(property, digestValue(value));
  }
  return found;
}
