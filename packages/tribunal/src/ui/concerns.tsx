/**
 * What reviewers suspect about a render, beside what they decided about it.
 *
 * A reviewer used to have two buttons for a change they were not sure of, and
 * both were wrong: *Reject* blocks a change that may be fine, and *Approve* with
 * a note buries the doubt the moment the baseline moves. A concern is the third
 * answer — "this looks wrong, and here is why I think so" — kept on the subject
 * across builds until somebody resolves it, and never touched by a decision.
 */

import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import type { Concern, ConcernState, ConcernTally, RaiseConcern } from '../concern-types.js';
import type { SubjectView } from '../review-types.js';
import type { ReviewClient } from './client.js';
import { ConcernForm, placed } from './concern-form.js';
import { messageOf } from './shell.js';
import { when } from './text.js';

export { evidenceFor } from './concern-form.js';

type Loaded =
  | { readonly kind: 'loading' }
  | { readonly kind: 'failed'; readonly message: string }
  | { readonly kind: 'ready'; readonly concerns: readonly Concern[] };

/** The concerns card on a subject page: its trail, and the form that adds to it. */
export function Concerns({
  client,
  reviewer,
  build,
  subject,
  onChanged,
}: {
  readonly client: ReviewClient;
  readonly reviewer: string;
  readonly build: string;
  readonly subject: SubjectView;
  /** Told after every concern that landed, so a count elsewhere can follow. */
  readonly onChanged?: (() => void) | undefined;
}): ReactElement {
  const [loaded, setLoaded] = useState<Loaded>({ kind: 'loading' });
  const [writing, setWriting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  // The subject on screen. The page keeps this panel from subject to subject, so
  // a write that answers after the reviewer moved on belongs to a trail that is
  // no longer drawn, and is dropped rather than added to the next one's.
  const shown = useRef(subject.subject);

  useEffect(() => {
    let live = true;
    shown.current = subject.subject;
    setLoaded({ kind: 'loading' });
    setWriting(false);
    setBusy(false);
    setFailed(null);
    client.concerns({ subject: subject.subject }).then(
      (answer) => live && setLoaded({ kind: 'ready', concerns: answer.concerns }),
      (error: unknown) => live && setLoaded({ kind: 'failed', message: messageOf(error) }),
    );
    return () => {
      live = false;
    };
  }, [client, subject.subject]);

  /**
   * Put a written concern where the list had it, or at the end when it is new.
   * A list that never loaded stays unloaded: one concern drawn alone would read
   * as the whole trail.
   */
  const keep = (concern: Concern): void =>
    setLoaded((was) => {
      if (was.kind !== 'ready') return was;
      const known = was.concerns.some((each) => each.id === concern.id);
      return {
        kind: 'ready',
        concerns: known
          ? was.concerns.map((each) => (each.id === concern.id ? concern : each))
          : [...was.concerns, concern],
      };
    });

  const write = async (action: () => Promise<Concern>): Promise<boolean> => {
    const on = subject.subject;
    setBusy(true);
    setFailed(null);
    try {
      const concern = await action();
      onChanged?.();
      if (shown.current !== on) return false;
      keep(concern);
      return true;
    } catch (error) {
      // Kept on the page, as a failed decision is: a concern that silently did not
      // land is a reviewer who believes the next one will see it.
      if (shown.current === on) setFailed(messageOf(error));
      return false;
    } finally {
      if (shown.current === on) setBusy(false);
    }
  };

  const save = async (input: RaiseConcern): Promise<void> => {
    if (await write(() => client.raise(input))) setWriting(false);
  };

  const move = (concern: Concern, state: ConcernState): void =>
    void write(() => client.moveConcern(concern.id, { state, by: reviewer }));

  return (
    <div className="va-concerns">
      {failed === null ? null : <p className="va-failure">{failed}</p>}
      {loaded.kind === 'loading' ? <p className="va-note">Reading concerns…</p> : null}
      {loaded.kind === 'failed' ? <p className="va-failure">{loaded.message}</p> : null}
      {loaded.kind === 'ready' && loaded.concerns.length === 0 && !writing ? (
        <p className="va-note">Nobody has flagged this render.</p>
      ) : null}
      {loaded.kind === 'ready'
        ? loaded.concerns.map((concern) => (
            <ConcernTrail
              key={concern.id}
              concern={concern}
              build={build}
              busy={busy}
              onMove={(state) => move(concern, state)}
            />
          ))
        : null}

      {writing ? (
        <ConcernForm
          subject={subject}
          build={build}
          reviewer={reviewer}
          busy={busy}
          onSave={(input) => void save(input)}
          onCancel={() => setWriting(false)}
        />
      ) : (
        <p className="va-actions">
          <button type="button" className="va-suspicious" onClick={() => setWriting(true)}>
            Looks suspicious
          </button>
        </p>
      )}
    </div>
  );
}

/** Where a concern can go from where it stands, as the buttons that take it there. */
const NEXT: Readonly<Record<ConcernState, readonly (readonly [ConcernState, string])[]>> = {
  open: [
    ['investigating', 'Investigate'],
    ['resolved', 'Resolve'],
  ],
  investigating: [['resolved', 'Resolve']],
  resolved: [['open', 'Reopen']],
};

/** One concern: what was suspected, where, on what, and every step since. */
export function ConcernTrail({
  concern,
  build,
  busy,
  onMove,
}: {
  readonly concern: Concern;
  /** The build on screen, so a concern raised in another one says so. */
  readonly build: string;
  readonly busy: boolean;
  readonly onMove: (state: ConcernState) => void;
}): ReactElement {
  return (
    <article className={`va-concern va-concern-${concern.state}`}>
      <header>
        <b>{concern.title}</b>
        <span className="va-concern-state">{concern.state}</span>
      </header>
      <p className="va-note">
        {concern.region === undefined ? 'the whole render' : placed(concern.region)}
        {concern.build === build ? null : <> · raised in {concern.build}</>}
      </p>
      {concern.evidence.length === 0 ? null : (
        <p className="va-evidence-list">
          {concern.evidence.map((name) => (
            <code key={name}>{name}</code>
          ))}
        </p>
      )}
      <ol className="va-concern-trail">
        {concern.events.map((event, index) => (
          <li key={index}>
            <span>
              {event.state} · {event.by} · {when(event.at)}
            </span>
            {event.note === undefined ? null : <p>{event.note}</p>}
            {event.hypothesis === undefined ? null : (
              <p>
                <i>Hypothesis:</i> {event.hypothesis}
              </p>
            )}
          </li>
        ))}
      </ol>
      <p className="va-actions">
        {NEXT[concern.state].map(([state, label]) => (
          <button key={state} type="button" disabled={busy} onClick={() => onMove(state)}>
            {label}
          </button>
        ))}
      </p>
    </article>
  );
}

/** The tally of a build, or why it could not be read, and a way to read it again. */
export function useConcernTally(
  client: ReviewClient,
  build: string,
): { readonly tally: ConcernTally | string | undefined; readonly refresh: () => void } {
  const [tally, setTally] = useState<ConcernTally | string | undefined>(undefined);
  // Only the latest request draws. An answer overtaken by a later one — for
  // another build, or for this one after another write — is dropped, so a slow
  // answer never counts the wrong build or an older count of this one.
  const latest = useRef(0);
  const refresh = useCallback(() => {
    const asked = ++latest.current;
    client.concerns({ seenIn: build }).then(
      (answer) => asked === latest.current && setTally(answer.tally),
      (error: unknown) => asked === latest.current && setTally(messageOf(error)),
    );
  }, [client, build]);
  useEffect(() => {
    setTally(undefined);
    refresh();
  }, [refresh]);
  return { tally, refresh };
}

/**
 * The concerns standing on a build, as one line for its header.
 *
 * Nothing at all when nothing was ever flagged: a row of three zeros on every
 * build is a header teaching its reader to skip it.
 */
export function ConcernTallyLine({
  tally,
}: {
  /** A string is why it could not be read, which is not the same as none. */
  readonly tally: ConcernTally | string | undefined;
}): ReactElement | null {
  if (tally === undefined) return null;
  if (typeof tally === 'string') {
    return (
      <span className="va-concern-tally va-unknown" title={tally}>
        concerns unread
      </span>
    );
  }
  if (tally.open + tally.investigating + tally.resolved === 0) return null;
  return (
    <span className="va-concern-tally">
      <b>{tally.open} flagged</b> · {tally.investigating} investigating · {tally.resolved} resolved
    </span>
  );
}
