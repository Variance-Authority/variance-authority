// What journals say: every edge the model declares and which the tests walked,
// and where two walks part.
import { back, stay, type AnyFragment, type Spec } from './contract.js';

/** One step a test walked, as a declared edge. */
export interface Step {
  readonly from: string;
  readonly action: string;
  readonly kind: 'stay' | 'lead' | 'raw';
  /** The declared outcome the app took, on a lead. */
  readonly outcome?: string;
  /** The outcome the test named; undefined when it went exploring. */
  readonly named?: string;
  readonly to: string;
  /** Why the step failed; a failed step walked no edge, though a wrong branch still names the outcome it reached. */
  readonly failed?: string;
}

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
  step.kind === 'raw'
    ? undefined
    : `${step.from}.${step.action}${step.outcome === undefined ? '' : ` → ${step.outcome}`}${step.failed === undefined ? '' : ' (failed)'}`;

/** How often the journals walked each declared edge, the edges none walked, and the steps taken around the broker. */
export function walked(declared: readonly string[], journals: readonly (readonly Step[])[]) {
  const counts: Record<string, number> = {};
  let raw = 0;
  for (const step of journals.flat()) {
    if (step.failed !== undefined) continue;
    const edge = edgeOf(step);
    if (edge === undefined) raw += 1;
    else counts[edge] = (counts[edge] ?? 0) + 1;
  }
  return { walked: counts, unwalked: declared.filter((edge) => counts[edge] === undefined), raw };
}

/** Two journals side by side, from the first step where they part. */
export function fork(a: readonly Step[], b: readonly Step[]): string {
  // A step is the declared edge it walked, so two outcomes that land on one fragment still part.
  const line = (step: Step | undefined) =>
    step === undefined ? '(ended)' : `${edgeOf(step) ?? `${step.from}.raw`}${step.named === undefined && step.kind === 'lead' ? ' (unnamed)' : ''}`;
  let at = 0;
  while (at < Math.max(a.length, b.length) && line(a[at]) === line(b[at])) at += 1;
  if (at === Math.max(a.length, b.length)) return 'the same walk';
  const shared = a.slice(0, at).map(line);
  return [
    `shared: ${shared.length === 0 ? '(nothing)' : shared.join('  ·  ')}`,
    `a: ${a.slice(at).map(line).join('  ·  ') || '(ended)'}`,
    `b: ${b.slice(at).map(line).join('  ·  ') || '(ended)'}`,
  ].join('\n');
}
