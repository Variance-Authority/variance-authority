/**
 * Renumbering every `useId` value in the tree, on demand.
 *
 * React's client `useId` draws from a module-global counter in `react-dom`, not
 * from the subject's own position, so ids depend on everything mounted since the
 * bundle was evaluated. In practice that means the ids in a story are a function
 * of which stories a developer happened to visit first — the canonical example of
 * a value that is *volatile* while the relationship it encodes (`<label for>` ↔
 * `<input id>`, `aria-describedby` ↔ help text) is *semantic*. ADR-0003 answers it
 * by aliasing rather than masking, and this is how the corpus provokes it.
 *
 * Note that the counter is never reset, so ids also differ between two runs of the
 * same test file in the same process. That is not a flaw in the fixture; it is the
 * bug, reproduced. A corpus that pinned the counter would be testing a world in
 * which the problem does not exist.
 */

import { useId } from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';

function IdConsumer(): null {
  useId();
  useId();
  return null;
}

/**
 * Advances React's global id counter by mounting and discarding `steps`
 * throwaway components in a detached root.
 *
 * Detached and immediately unmounted on purpose: the perturbation must be visible
 * *only* in the subject's id values. If the throwaway components stayed in the
 * document, the case would be testing node insertion as well, and a hash movement
 * would no longer isolate a single cause.
 */
export function shiftIdCounter(doc: Document, steps: number): void {
  if (steps <= 0) return;
  const host = doc.createElement('div');
  const root = createRoot(host);
  const filler = Array.from({ length: steps }, (_, i) => <IdConsumer key={i} />);
  flushSync(() => {
    root.render(<>{filler}</>);
  });
  root.unmount();
  host.remove();
}
