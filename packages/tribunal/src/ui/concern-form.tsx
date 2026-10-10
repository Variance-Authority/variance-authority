/**
 * The form behind "Looks suspicious".
 *
 * Apart from the panel that lists concerns because it is the one part of it with
 * state of its own — what the reviewer has typed and not yet saved — and a
 * reviewer who closes the form expects that state gone, not kept in the list.
 */

import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { CONCERN_STATES, type ConcernRegion, type ConcernState, type RaiseConcern } from '../concern-types.js';
import type { SubjectView } from '../review-types.js';
import { number } from './text.js';

/**
 * What a reviewer can point at on this render, in the order they would.
 *
 * The regions the run attributed, causes first because a suspicion is usually
 * about the edit and not about what it pushed, each by component and then by
 * file. `baseline` last, for the concern that the *baseline* is the wrong
 * picture — which the region list cannot name, because it is a list of what
 * differs from it.
 */
export function evidenceFor(subject: SubjectView): readonly string[] {
  const ordered = [...subject.regions.filter((r) => r.cause), ...subject.regions.filter((r) => !r.cause)];
  const names = ordered.flatMap((region) => [region.component, region.file]).filter((name) => name !== undefined);
  return [...new Set([...names, 'baseline'])];
}

/** One rectangle, as the trail and the scope picker both say it. */
export function placed(region: { readonly x: number; readonly y: number; readonly width: number; readonly height: number }): string {
  return `${number(region.width)}×${number(region.height)} at ${number(region.x)},${number(region.y)}`;
}

/**
 * One rectangle and the component it was attributed to, `Button · 24×18 at
 * 154,85`, as the scope picker offers it and a saved concern names it. `unnamed`
 * stands in for a missing component; without it the rectangle stands alone.
 */
export function named(region: ConcernRegion, unnamed?: string): string {
  const component = region.component ?? unnamed;
  return component === undefined ? placed(region) : `${component} · ${placed(region)}`;
}

export function ConcernForm({
  subject,
  build,
  reviewer,
  busy,
  initial = 'open',
  asked,
  onSave,
  onCancel,
}: {
  readonly subject: SubjectView;
  readonly build: string;
  readonly reviewer: string;
  readonly busy: boolean;
  /** The state the form starts in; *Flag as investigating* opens it already taken. */
  readonly initial?: ConcernState | undefined;
  /** Counts the requests for `initial`, so asking for the same state again resets it. */
  readonly asked?: number | undefined;
  readonly onSave: (input: RaiseConcern) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const [title, setTitle] = useState('');
  const [note, setNote] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [scope, setScope] = useState('');
  const [chosen, setChosen] = useState<readonly string[]>([]);
  const [state, setState] = useState<ConcernState>(initial);
  // Asked again while open — *Flag as investigating* after *Looks suspicious* — the state
  // follows and what was typed stays.
  useEffect(() => setState(initial), [initial, asked]);

  const offered = evidenceFor(subject);
  const ready = title.trim() !== '' && !busy;

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!ready) return;
    const region = scope === '' ? undefined : subject.regions[Number(scope)];
    onSave({
      build,
      subject: subject.subject,
      title: title.trim(),
      by: reviewer,
      ...(note.trim() === '' ? {} : { note: note.trim() }),
      ...(hypothesis.trim() === '' ? {} : { hypothesis: hypothesis.trim() }),
      ...(region === undefined
        ? {}
        : {
            region: {
              x: region.x,
              y: region.y,
              width: region.width,
              height: region.height,
              ...(region.component === undefined ? {} : { component: region.component }),
            },
          }),
      ...(chosen.length === 0 ? {} : { evidence: chosen }),
      state,
    });
  };

  const toggle = (name: string): void =>
    setChosen((was) => (was.includes(name) ? was.filter((each) => each !== name) : [...was, name]));

  return (
    <form className="va-concern-form" onSubmit={submit}>
      <label>
        <span>What looks wrong</span>
        <input
          name="title"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Total moved below the fold"
          autoFocus
        />
      </label>

      {subject.regions.length === 0 ? null : (
        <label>
          <span>Where</span>
          <select name="region" value={scope} onChange={(event) => setScope(event.target.value)}>
            <option value="">The whole render</option>
            {subject.regions.map((region, index) => (
              <option key={index} value={String(index)}>
                {named(region, 'unattributed')}
              </option>
            ))}
          </select>
        </label>
      )}

      <label>
        <span>Note</span>
        <textarea name="note" rows={3} value={note} onChange={(event) => setNote(event.target.value)} />
      </label>

      <label>
        <span>Hypothesis</span>
        <input
          name="hypothesis"
          value={hypothesis}
          onChange={(event) => setHypothesis(event.target.value)}
          placeholder="What you think caused it, if you have a guess"
        />
      </label>

      <fieldset className="va-evidence">
        <legend>Evidence</legend>
        {offered.map((name) => (
          <button
            key={name}
            type="button"
            className={chosen.includes(name) ? 'va-chosen' : undefined}
            aria-pressed={chosen.includes(name)}
            onClick={() => toggle(name)}
          >
            {name}
          </button>
        ))}
      </fieldset>

      <fieldset className="va-concern-states">
        <legend>State</legend>
        {CONCERN_STATES.map((each) => (
          <label key={each}>
            <input
              type="radio"
              name="state"
              value={each}
              checked={state === each}
              onChange={() => setState(each)}
            />
            {each}
          </label>
        ))}
      </fieldset>

      <p className="va-actions">
        <button type="submit" className="va-approve" disabled={!ready}>
          Save concern
        </button>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
      </p>
    </form>
  );
}
