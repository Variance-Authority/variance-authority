import type { Parting, PartedBoundary, MovedInput } from './parting.js';
import type { PartingSlice } from './slice.js';

/**
 * A parting, spoken.
 *
 * The rung a run reached is only worth what a reader takes from it, and the
 * three sentences below are three different products:
 *
 * ```text
 * a <div> rendered <p> on one side and <span> on the other
 * Summary was handed a different `total`
 * Cart chose differently — useState #2 moved, and Summary's `total` follows
 * ```
 *
 * The first is a diff. The second localises. Only the third names a cause, and
 * it is the only one somebody can act on without opening the component and
 * guessing. So the shape here is an **origin and its manifestations**, not a
 * flat list: an origin line, then the boundaries and deltas downstream of it,
 * indented. A collateral boundary with no origin above it gets a line of its own
 * — that is a parting this run could not trace further, and hiding it under
 * something else would overstate what was found.
 */
export function explainParting(parting: Parting): readonly string[] {
  const boundaries = parting.boundaries;
  const headline = slice(parting.slice);

  if (boundaries === undefined) {
    return [headline, '  no framework boundary was read, so nothing can be said about why'];
  }
  if (boundaries.length === 0) {
    return [headline, '  every boundary read held its inputs and its output'];
  }

  const origins = parting.origins ?? [];
  const claimed = new Set<PartedBoundary>();
  const lines: string[] = [headline];

  for (const origin of origins) {
    if (claimed.has(origin)) continue;
    claimed.add(origin);
    const downstream = boundaries.filter(
      (other) => !claimed.has(other) && under(origin.path, other.path),
    );
    for (const other of downstream) claimed.add(other);

    lines.push(sentence(origin));
    lines.push(...deltaLines(origin, boundaries));

    // The avalanche. One input at a fork can put a boundary on every component
    // beneath it, and enumerating them buries the one line worth reading under
    // its own consequences. Past the cap the fan-out is stated as a size —
    // pointing at the fork is the finding, and the boundary list is still there
    // for a caller that wants to walk it.
    if (downstream.length > FANOUT) {
      const deltas = downstream.reduce((total, other) => total + other.deltas, 0);
      lines.push(
        `  manifests across ${downstream.length} boundaries below it` +
          (deltas > 0 ? `, ${deltas} delta${deltas === 1 ? '' : 's'} in all` : ''),
      );
    } else {
      for (const other of downstream) {
        lines.push(`  manifests as ${sentence(other)}`);
        lines.push(...deltaLines(other, boundaries).map((line) => `  ${line}`));
      }
    }
  }

  for (const rest of boundaries) {
    if (claimed.has(rest)) continue;
    lines.push(sentence(rest));
    lines.push(...deltaLines(rest, boundaries));
  }

  return lines;
}

function sentence(boundary: PartedBoundary): string {
  const { component, inputs } = boundary;

  switch (boundary.rung) {
    case 'stateful':
      return `${component} chose differently — ${list(inputs.filter(isHook))} moved`;
    case 'external':
      return `${component} read a different external store — ${list(inputs.filter(isHook))} moved`;
    case 'provided':
      return `${component} was given a different ${list(inputs.filter((i) => i.kind === 'context'))}`;
    case 'handed':
      return `${component} was handed a different ${list(inputs.filter((i) => i.kind === 'prop'))}`;
    // Phrased at the ancestor rather than at the component, because that is
    // where the reader has to go. `Price` did nothing; something it is standing
    // inside declared a value it never declares for itself.
    case 'inherited':
      return (
        `${component} inherited a different ` +
        `${list(inputs.filter((i) => i.kind === 'inherited'))} — an ancestor declared it`
      );
    case 'undetermined':
      return `${component} rendered differently from inputs that all agreed — nondeterministic`;
    case 'unread':
      return `${component} rendered differently, and what it holds could not be read`;
    case 'unpaired':
      return `${component} is present on one side only`;
  }
}

/** What `holdingOf` writes for a context React could not name. */
const ANONYMOUS = '(anonymous)';

function isHook(input: MovedInput): boolean {
  return input.kind === 'hook';
}

/**
 * Name the moved inputs, hooks by call position.
 *
 * `useState #2` rather than `useState` because a component with four `useState`
 * calls is the ordinary case, and a sentence naming the hook without saying
 * which one sends the reader back to counting — the work this module exists to
 * have already done.
 */
function list(inputs: readonly MovedInput[]): string {
  const named = inputs.map((input) => {
    if (input.index !== undefined) return `${input.name} #${input.index}`;
    // A `createContext` call with no `displayName` is the common case, and
    // "a different `(anonymous)`" names the gap in React's metadata rather than
    // the thing that moved.
    return input.name === ANONYMOUS ? 'context value' : `\`${input.name}\``;
  });
  if (named.length === 0) return 'input';
  if (named.length === 1) return named[0] as string;
  return `${named.slice(0, -1).join(', ')} and ${named[named.length - 1] as string}`;
}

/**
 * The deltas at a boundary, and the one case worth saying nothing about.
 *
 * A boundary owning no delta is only *quiet* if nothing under it owns one
 * either. Otherwise the deltas are real and belong to a nested boundary, whose
 * own line already reports them — and "and rendered the same anyway" directly
 * beneath "chose differently" reads as a contradiction rather than as the
 * ownership statement it is.
 */
function deltaLines(
  boundary: PartedBoundary,
  all: readonly PartedBoundary[],
): readonly string[] {
  if (boundary.deltas === 0) {
    const moved = all.some((other) => under(boundary.path, other.path) && other.deltas > 0);
    return moved ? [] : ['  and rendered the same anyway'];
  }
  const bands = boundary.bands.join(', ');
  const count = `${boundary.deltas} delta${boundary.deltas === 1 ? '' : 's'} here (${bands})`;
  return [`  ${count}${named(boundary.moved)}`];
}

const SHOWN = 4;

/** Above this many boundaries under one origin, the fan-out is the finding. */
const FANOUT = 3;

/**
 * The triage line, first, before anything about which input moved.
 *
 * Deliberately a whole sentence rather than the bare word: `refactor` alone
 * reads as a label somebody applied, and the clause is the evidence for it.
 */
function slice(kind: PartingSlice): string {
  switch (kind) {
    case 'settled':
      return 'settled — the component tree, its inputs and its output all held';
    case 'variation':
      return 'variation — an input moved and the page followed';
    case 'flake':
      return 'flake — every input agreed, the component tree held, and the page moved anyway';
    case 'reshaped':
      return 'reshaped — the component tree is a different tree and the page followed';
    case 'refactor':
      return 'refactor — the component tree moved and the page did not';
    case 'absorbed':
      return 'absorbed — an input moved and the page did not';
    case 'unread':
      return 'unread — the page moved and what would explain it was not read';
  }
}

/**
 * The properties that moved, truncated where a list stops being a sentence.
 *
 * Four because `padding` expands to four longhands and a reader who has seen
 * the first learns nothing from the rest. What was dropped is counted rather
 * than elided — a list that quietly ends reads as the whole list.
 */
function named(moved: readonly string[] | undefined): string {
  if (moved === undefined || moved.length === 0) return '';
  if (moved.length <= SHOWN) return ` — ${moved.join(', ')}`;
  return ` — ${moved.slice(0, SHOWN).join(', ')} and ${moved.length - SHOWN} more`;
}

/**
 * Whether one path encloses another, strictly.
 *
 * Segment-aware: `0/1` must not swallow `0/10`, and a plain `startsWith` would
 * make every tenth sibling collateral of its second.
 */
function under(ancestor: string, path: string): boolean {
  if (ancestor === path) return false;
  return ancestor === '' || path.startsWith(`${ancestor}/`);
}
