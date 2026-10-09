/**
 * A decision the service refused because the baseline moved under it, said
 * once, in the page's words.
 *
 * The service answers 409 with a whole sentence and, beside it, the two facts it
 * was built from: the baseline the page read and the one standing now. The
 * sentence is for a caller that prints it. A page already has a headline of its
 * own, and printing the sentence under it said "moved while you were reviewing"
 * twice and spelled out two digests in full. This says the headline once and the
 * digests as short as the page prints a commit, with the whole one a hover away.
 *
 * Shown on both pages a decision is taken on, each with a reload, because the
 * remedy is the same on both: read the subject again, which brings the version
 * standing now, and decide against that.
 */

import type { ReactElement } from 'react';
import { ReviewRequestError, type MovedBaseline } from './client.js';

/** The facts of a refusal over a baseline that moved, or `undefined` for any other failure. */
export function movedOf(error: unknown): MovedBaseline | undefined {
  return error instanceof ReviewRequestError && error.status === 409 ? error.moved : undefined;
}

export function BaselineMovedNotice({
  moved,
  subject,
  reload,
  busy,
  onReload,
}: {
  readonly moved: MovedBaseline;
  /** The render it was refused for, when the decision covered more than one. */
  readonly subject?: string;
  /** The button's label, which names what a reload reads again. */
  readonly reload: string;
  readonly busy: boolean;
  readonly onReload: () => void;
}): ReactElement {
  return (
    <div className="va-failure">
      <p>
        <strong>
          The baseline{subject === undefined ? null : <> for <code>{subject}</code></>} changed while you were
          reviewing.
        </strong>{' '}
        <Facts moved={moved} />{' '}
        {subject === undefined
          ? 'Nothing was recorded.'
          : 'No decision was recorded for it, nor for any render after it.'}
      </p>
      {/* Reading the build again is what a decision does too. It brings the
          version of the baseline standing now, and with it whether the render is
          still undecided; the images stay the ones the run compared. */}
      <button type="button" disabled={busy} onClick={onReload}>
        {reload}
      </button>
    </div>
  );
}

function Facts({ moved: { read, current } }: { readonly moved: MovedBaseline }): ReactElement {
  return (
    <>
      You read {read === null ? 'none' : <>the one painted from document <Digest value={read} /></>};{' '}
      {current === null ? (
        'none stands now'
      ) : (
        <>
          the one standing now is painted from document <Digest value={current} />
        </>
      )}
      .
    </>
  );
}

/**
 * A document digest as short as the page prints a commit: its scheme, if it
 * names one, and eight characters of the hash.
 */
function Digest({ value }: { readonly value: string }): ReactElement {
  return <code title={value}>{value.slice(0, value.indexOf(':') + 9)}</code>;
}
