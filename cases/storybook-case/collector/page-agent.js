/**
 * The browser half of this project's collector.
 *
 * `variance run` cannot ship this and should not try. Mounting a project's
 * components, waiting for them to settle and serializing the result needs the
 * project's own bundle, its own providers and its own idea of "ready" — every
 * tool that has claimed otherwise grew a plugin system whose failures are
 * undebuggable from either side. So the CLI names a module, the module names this
 * file, and the contract between them is two functions and a JSON string.
 *
 * What this does is the whole of the operator's obligation:
 *
 * - **acquire** a `RenderDocument` — the subject's markup, the CSS that actually
 *   applies to it, the ancestor frame and the inherited floor. This is what a
 *   renderer paints, here or on a machine that pins its pixels.
 * - **collect** a `RawCapture` — the same subtree as a tree of observations, which
 *   is what gives every changed region a node, a component and a file.
 *
 * Both from *one* mount, deliberately. Two mounts would be two renders, and any
 * disagreement between the image and the names attached to it would be a story
 * about which of them was looking at what.
 *
 * Bundled as an IIFE and injected with `addScriptTag`. A module would evaluate
 * asynchronously and the collector's "did the bundle install?" check would race it
 * instead of catching a broken one.
 */
import { acquireDocument, collect } from '@variance-authority/dom';
import { portalContentOf, provenanceOf } from '@variance-authority/react';

export const AGENT = '__VA_STORYBOOK_COLLECTOR__';

/**
 * The story's own mount point, never the preview body.
 *
 * Storybook's chrome — the preview reset, the addon layout, the error overlay —
 * lives outside `#storybook-root`, so acquiring from the root element is what
 * keeps it out of the subject. Nothing here has a denylist for it, and that is
 * the point of ADR-0003: a rule that matches nothing inside the subtree is
 * pruned because it matches nothing, not because somebody listed it.
 */
function rootOf(selectors) {
  for (const selector of selectors) {
    const found = window.document.querySelector(selector);
    if (found !== null) return found;
  }
  throw new Error(`no story root among ${selectors.join(', ')}`);
}

function acquire(request) {
  const root = rootOf(request.roots);

  const shared = {
    subject: { id: request.subjectId, kind: 'story' },
    viewport: request.viewport,
    ...(request.fonts ? { fonts: request.fonts } : {}),
  };

  // The style index is built once and handed to both, which is not only a
  // saving: two indexes built either side of a lazily-inserted `<style>` would
  // describe two different documents, and the run would compare an image of one
  // against the names of the other.
  const document = acquireDocument(root, shared);
  const capture = collect(root, {
    ...shared,
    engine: request.engine,
    portalsOf: portalContentOf,
    provenanceOf,
  });

  return JSON.stringify({ document, capture });
}

window[AGENT] = { acquire, version: 'storybook-case@0' };
