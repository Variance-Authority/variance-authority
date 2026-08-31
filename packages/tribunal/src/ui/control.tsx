/**
 * Where this component did not move — the arm no diffing tool has.
 *
 * Every other line on this page is about the renders that changed, which is the
 * only population a pixel comparison can see. The run holds a second one: sites
 * of the same component, under the *same props*, whose hashes it read and found
 * unmoved. That is a control group, and it turns a change from a list of
 * casualties into a measurement.
 *
 * The reading is what the reviewer wants and it is short. `Button` was edited and
 * held in four renders means the edit was to something those four do not use — a
 * variant, a size, a state — and it bounds the blast radius with evidence rather
 * than with a count of what happened to be collected. `Button` was edited and
 * held nowhere means nothing under those props escaped it.
 *
 * ## Why this can only be the run's answer
 *
 * The props class is the load-bearing half and it never crosses the wire. Two
 * renders of a component given different inputs are not controls for each other —
 * they are two questions that share a name — and the store carries the census
 * without the digest each rendering was grouped under. The page can see *where a
 * component appears*; only the run can see *where it appears the same way*.
 *
 * ## Empty is two findings, and the denominator is what tells them apart
 *
 * A control group of nothing is either *this component renders nowhere else with
 * these inputs* — a suite with nothing to say — or *it renders in four other
 * places and moved in all four*, which is the suite saying the loudest thing it
 * can. On the example every control group is the second kind: the restyle reached
 * every render of `Button` and `CardFooter` under their own props, and a page
 * that stayed silent about that would drop the one measurement it had.
 *
 * So `compared` is read beside `held`, and where it is absent — a build ingested
 * before the run carried it — the section says nothing at all. A missing input is
 * not a finding.
 */

import type { ReactElement } from 'react';
import type { Origin } from './grouping.js';
import type { Route } from './route.js';
import { Go } from './shell.js';
import { count } from './text.js';

/** Renders that held, the renders they are a control for, and the pool. */
export interface Controls {
  /** Subjects where the same component with the same props was read and unmoved. */
  readonly held: readonly string[];
  /** Renders of this change that had a control, out of every render it has. */
  readonly of: number;
  readonly renders: number;
  /**
   * The widest pool any appearance was compared against, or `undefined` when no
   * appearance said.
   *
   * The widest and not the sum: the pools overlap — the same four other renders
   * of `Button` are the comparison for each of its appearances — and adding them
   * would report sixteen comparisons where four were made.
   */
  readonly compared?: number;
}

export function controlsFor(origin: Origin): Controls {
  const held: string[] = [];
  const seen = new Set<string>();
  let of = 0;
  let compared: number | undefined;

  for (const { movement } of origin.appearances) {
    // Absent is not empty: a build ingested before attributions were carried has
    // no movement at all, and counting it as a render without a control would
    // report a missing input as a finding.
    if (movement === undefined) continue;
    if (movement.held.length > 0) of += 1;
    if (movement.compared !== undefined && (compared === undefined || movement.compared > compared)) {
      compared = movement.compared;
    }
    for (const subject of movement.held) {
      if (seen.has(subject)) continue;
      seen.add(subject);
      held.push(subject);
    }
  }

  return { held, of, renders: origin.appearances.length, ...(compared === undefined ? {} : { compared }) };
}

export function HeldStill({
  controls,
  build,
  go,
}: {
  readonly controls: Controls;
  readonly build: string;
  readonly go: (route: Route) => void;
}): ReactElement | null {
  if (controls.held.length === 0) {
    // Nothing held, and the two reasons for that point opposite ways. Only the
    // denominator separates them, and without one there is nothing to say.
    if (controls.compared === undefined || controls.compared === 0) return null;

    return (
      <p className="va-held va-held-none">
        <span className="va-held-mark">Held nowhere</span> — the same component
        under the same props was read in {count(controls.compared, 'other render')} and moved in
        every one. Nothing under these props escaped the change.
      </p>
    );
  }

  return (
    <p className="va-held">
      <span className="va-held-mark">Held still</span> in {count(controls.held.length, 'render')} —
      same component, same props, hashes read and unmoved:{' '}
      {controls.held.map((subject, index) => (
        <span key={subject}>
          {index === 0 ? null : ', '}
          <Go to={{ page: 'subject', build, subject }} go={go} className="va-held-go">
            {subject}
          </Go>
        </span>
      ))}
      .
      {controls.of === controls.renders ? null : (
        <span className="va-note">
          {' '}
          — a control for {controls.of} of {controls.renders} renders of this change.
        </span>
      )}
    </p>
  );
}
