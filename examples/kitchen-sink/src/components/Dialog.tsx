/**
 * The subtree-boundary fixture. This one is here to expose an *open question*, not
 * to confirm a decision.
 *
 * ADR-0003 defines the pruning and aliasing scope as "the subject subtree", and
 * every other fixture makes that unambiguous because the subject subtree is the
 * container it was rendered into. A portal breaks the equivalence: the dialog's
 * panel is a child of `Dialog` in the React tree and a child of `document.body` in
 * the DOM. So "the subject subtree" names two different sets of nodes, and the two
 * readings disagree about the most important verdict in the system:
 *
 * - **DOM reading** — opening the dialog adds nothing inside the container, so the
 *   subject's hash is unchanged. A dialog appearing is reported as `unchanged`.
 *   That is a false `unchanged`, which ADR-0002 calls the one thing the tool must
 *   never do.
 * - **Fiber reading** — the portal's content belongs to the subject because its
 *   owner chain leads back into it, so it is captured and the hash moves.
 *
 * The corpus declares the fiber reading as ground truth and flags the case, rather
 * than silently encoding a decision no ADR has made. If the eventual collector
 * takes the DOM reading, this case fails loudly — which is the point of putting it
 * in a corpus instead of a comment.
 *
 * The trigger is `aria-describedby` pointing from the panel *back into* the
 * subject's container, so the case also exercises the `#extern:n` path: under the
 * DOM reading that reference escapes the subtree and must be flagged, not hidden.
 */

import type { ReactNode } from 'react';
import { useId } from 'react';
import { createPortal } from 'react-dom';

export interface DialogProps {
  readonly open: boolean;
  readonly title: string;
  readonly children: ReactNode;
  /** Where the portal lands. Supplied by the fixture so a collector can be handed
   * both the container and the portal host and decide what "subtree" means. */
  readonly host: HTMLElement | null;
  /** Summary line rendered inside the container, referenced from the portal. */
  readonly summary: string;
}

export function Dialog({ open, title, children, host, summary }: DialogProps) {
  const titleId = useId();
  const summaryId = useId();

  const panel = (
    <div className="ks-dialog__backdrop">
      <div className="ks-dialog__panel" role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={summaryId}>
        <h2 id={titleId} className="ks-card__title">
          {title}
        </h2>
        {children}
      </div>
    </div>
  );

  return (
    <div className="ks-dialog">
      <p id={summaryId} className="ks-field__help">
        {summary}
      </p>
      {open && host !== null ? createPortal(panel, host) : null}
    </div>
  );
}

Dialog.displayName = 'Dialog';
