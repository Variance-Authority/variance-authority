// The model as the app's test interface: every edge it declares, and which the
// journals walked.
import { back, stay, type AnyFragment, type Spec, type Step } from './broker.js';

/** Every edge the model declares, from the fragments given to those their outcomes and parts reach. */
export function edges(roots: readonly AnyFragment[]): string[] {
  const seen = new Set<AnyFragment>();
  const found: string[] = [];
  const visit = (fragment: AnyFragment | undefined) => {
    if (fragment === undefined || seen.has(fragment)) return;
    seen.add(fragment);
    const spec = fragment.spec as Spec;
    for (const [name, declared] of Object.entries(spec.actions ?? {})) {
      if (typeof declared === 'function' || declared.kind === 'stays') {
        found.push(`${fragment.name}.${name}`);
        continue;
      }
      for (const [outcome, to] of Object.entries(declared.outcomes)) {
        found.push(`${fragment.name}.${name} → ${outcome}`);
        if (to !== stay && to !== back) visit('cover' in to ? to.cover : to);
      }
    }
    for (const part of Object.values(spec.uses ?? {})) visit(part);
  };
  for (const root of roots) visit(root);
  return found.sort();
}

/** The edge one step walked, spelled as `edges` spells it; none for a raw step. */
const edgeOf = (step: Step) =>
  step.kind === 'raw' ? undefined : step.kind === 'stay' ? `${step.from}.${step.action}` : `${step.from}.${step.action} → ${step.outcome}`;

/** How often the journals walked each declared edge, the edges none walked, and the steps taken around the broker. */
export function walked(declared: readonly string[], journals: readonly (readonly Step[])[]) {
  const counts: Record<string, number> = {};
  let raw = 0;
  for (const step of journals.flat()) {
    const edge = edgeOf(step);
    if (edge === undefined) raw += 1;
    else counts[edge] = (counts[edge] ?? 0) + 1;
  }
  return { walked: counts, unwalked: declared.filter((edge) => counts[edge] === undefined), raw };
}
