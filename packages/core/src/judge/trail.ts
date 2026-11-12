import {
  causesBetween,
  hashComponents,
  type ComponentHash,
} from '../attribute/component-hash.js';
import type { Digest } from '../format/hash.js';
import type { SemanticSnapshot } from '../format/snapshot.js';

/**
 * What a working session accumulates, for the loop an agent actually runs.
 *
 * `observePair` compares two documents and keeps nothing, which is right for a
 * one-shot ephemeral run and wrong for the setting the mode exists to serve. An
 * agent editing components runs: observe, edit, observe, edit. Each observation
 * on its own can answer *what moved since the previous one*, and the questions
 * that decide what to do next are all about the trajectory:
 *
 * - **What have I changed since I started?** The difference between now and the
 *   first step, which is the diff a reviewer will eventually read — never the
 *   sum of the per-step differences, because an edit and its revert cancel.
 * - **Did my last edit fix what I broke two edits ago?** Components that moved
 *   away from the starting state and have since come back to it.
 * - **Is this the same difference I already saw?** A render hash that has been
 *   seen before means the subject has returned to a state this session already
 *   observed — going in circles, which is the failure mode of an agent that
 *   cannot see its own history.
 *
 * ## Why this is cheap
 *
 * A step is a *snapshot*, not an image. Collecting one is ~7.5 ms against ~65 ms
 * to paint (journal 0007, ADR-0010), and the interesting questions above are all
 * answerable from component hashes and a render hash — text. A paint happens when
 * somebody asks a question about pixels, which in an author loop is rarely and
 * never on every step.
 *
 * ## Why it is here and not in a store
 *
 * A trail is a value and this module is a function over it. Nothing accumulates
 * on disk, nothing is keyed by anything, and the standing constraint that images
 * are never kept in something that accumulates is satisfied by construction:
 * there are no images in it. The holder is whoever runs the loop — an MCP server
 * for a session, a test for its duration — and when they stop holding it, it is
 * gone. That is the ephemeral contract (ADR-0011), not an exception to it.
 *
 * ## What it cannot see
 *
 * Anything the semantic tier cannot. A `RenderDocument`'s `assets` map is
 * optional and no shipped collector fills it, so an image swapped behind an
 * unchanged URL moves no hash here and no step will mention it. That is stated
 * rather than pending: a trail is a cheap tier, and a cheap tier's blind spots
 * are the price of it being cheap. Ask a raster question when the answer matters.
 */

export interface TrailStep {
  /**
   * Position in the trail, from `0`. Not a time.
   *
   * `core` has no clock, and an ordinal is the better key anyway: an agent asks
   * "since I started" and "since my last edit", never "since 14:03".
   */
  readonly at: number;

  /** What the author said they were doing. Carried, never matched on. */
  readonly label?: string;

  /** Identity of the subject's state. Equal hashes are the same render. */
  readonly renderHash: Digest;

  readonly components: readonly ComponentHash[];
}

export interface Trail {
  readonly subject: string;
  readonly steps: readonly TrailStep[];
}

/** An empty trail for a subject. The first `record` gives it a starting state. */
export function startTrail(subject: string): Trail {
  return { subject, steps: [] };
}

/**
 * Add this observation to the trail.
 *
 * @throws {Error} when the snapshot is of a different subject. A trail is one
 * subject's history, and appending another's would make every question below
 * answer about a mixture — silently, since the shapes are identical.
 */
export function record(trail: Trail, snapshot: SemanticSnapshot, label?: string): Trail {
  if (snapshot.subject.id !== trail.subject) {
    throw new Error(
      `refusing to record \`${snapshot.subject.id}\` on the trail for \`${trail.subject}\`: ` +
        'a trail is one subject and mixing two would answer every question about neither',
    );
  }

  const step: TrailStep = {
    at: trail.steps.length,
    ...(label !== undefined ? { label } : {}),
    renderHash: snapshot.renderHash,
    components: hashesOf(snapshot),
  };

  return { subject: trail.subject, steps: [...trail.steps, step] };
}

export interface Progress {
  /** Components differing from where this session started. The reviewable diff. */
  readonly changed: readonly string[];

  /** Components that differ from the previous step. What the last edit did. */
  readonly sinceLast: readonly string[];

  /**
   * Components that had moved away from the starting state and are back at it.
   *
   * The question an agent cannot otherwise ask. Reverting a component is
   * invisible to a per-step comparison — the step *before* the revert saw it
   * change, and the step after sees it change back, and neither says the net
   * effect is nothing. Only the start does.
   */
  readonly repaired: readonly string[];

  /**
   * The earlier step this state is identical to, when there is one.
   *
   * A render hash that has been seen before means the subject is exactly where it
   * already was, which for an agent means the loop is going in circles. Nothing
   * else in the system can notice, because every other comparison has two
   * elements and this needs the whole history.
   */
  readonly returnedTo?: number;

  /** `true` when the subject is exactly as this session found it. */
  readonly atStart: boolean;
}

/**
 * Where the session has got to, in the terms the next decision needs.
 *
 * Deliberately four answers rather than a diff. A diff is what a reviewer reads
 * at the end; what an author needs *during* the loop is whether they are closer
 * than they were, which no single comparison can say.
 *
 * A trail of fewer than two steps has no progress to report — one observation is
 * a starting state, and calling that "nothing changed" would be a claim about an
 * edit nobody has made yet.
 */
export function progress(trail: Trail): Progress | null {
  const first = trail.steps[0];
  const last = trail.steps.at(-1);
  if (first === undefined || last === undefined || trail.steps.length < 2) return null;

  const previous = trail.steps.at(-2)!;

  const changed = causesBetween(first.components, last.components);
  const everChanged = new Set(
    trail.steps.slice(1, -1).flatMap((step) => causesBetween(first.components, step.components)),
  );
  const stillChanged = new Set(changed);

  const seen = trail.steps
    .slice(0, -1)
    .find((step) => step.renderHash === last.renderHash);

  return {
    changed,
    sinceLast: causesBetween(previous.components, last.components),
    repaired: [...everChanged].filter((component) => !stillChanged.has(component)).sort(),
    ...(seen !== undefined ? { returnedTo: seen.at } : {}),
    atStart: last.renderHash === first.renderHash,
  };
}

/**
 * The trail as the paragraph an agent reads before deciding what to do next.
 *
 * Written for a reader that acts on one sentence, so the ordering is by what
 * changes the next move: whether the work is done, whether it is going in
 * circles, what the last edit did, and only then the accumulated diff.
 */
export function summarizeTrail(trail: Trail): string {
  const state = progress(trail);
  if (state === null) {
    return `${trail.subject}: ${trail.steps.length} step(s) recorded, nothing to compare yet.`;
  }

  const lines = [`${trail.subject}: ${trail.steps.length} steps.`];

  if (state.atStart) {
    lines.push('  The subject is exactly as this session found it. Nothing has net changed.');
  } else {
    lines.push(
      `  Changed since step 0: ${state.changed.length === 0 ? 'nothing nameable' : state.changed.join(', ')}`,
    );
  }

  if (state.returnedTo !== undefined && !state.atStart) {
    lines.push(
      `  This state is identical to step ${state.returnedTo}. The last edits have cancelled ` +
        'out — a different approach is needed, not another attempt at this one.',
    );
  }

  lines.push(
    `  The last edit moved: ${state.sinceLast.length === 0 ? 'nothing' : state.sinceLast.join(', ')}`,
  );

  if (state.repaired.length > 0) {
    lines.push(`  Back to where it started: ${state.repaired.join(', ')}`);
  }

  return lines.join('\n');
}

/**
 * Component hashes for a snapshot, computed here rather than accepted.
 *
 * A parameter would let a caller hand a trail the hashes of one document beside
 * the render hash of another, which makes every answer above quietly wrong and
 * nothing detects it. Computing costs one walk of a tree already in hand.
 */
function hashesOf(snapshot: SemanticSnapshot): readonly ComponentHash[] {
  return hashComponents(snapshot);
}
