/**
 * The `jsdom` capture path, in one place.
 *
 * Extracted so that the `jsdom`-only measurement and the two-profile comparison
 * cannot drift apart. P4 asks whether the profiles agree; if each measurement
 * built its own `collect` call, a disagreement could always be explained by the
 * harness rather than by the collectors, and the claim would be unfalsifiable.
 *
 * Requires a `document`, so a caller needs a jsdom environment. It is deliberately
 * not re-exported from the package index for that reason.
 */

import { collect } from '@variance-authority/dom';
import type { SemanticSnapshot, Viewport } from '@variance-authority/core/format';
import { normalize } from '@variance-authority/core/rules';
import { portalContentOf, provenanceOf } from '@variance-authority/react';
import { renderCase } from './render.js';
import type { SubjectId } from './subjects.js';
import type { VariantId } from './variants.js';

export const CORPUS_VIEWPORT: Viewport = {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
  colorScheme: 'light',
};

/** Same string under both profiles, so a font is never the reason they differ. */
export const CORPUS_FONTS: readonly string[] = ['Inter/400/normal/corpus'];

export function jsdomSnapshot(subject: SubjectId, variant: VariantId): SemanticSnapshot {
  document.body.innerHTML = '';
  const host = document.createElement('div');
  document.body.appendChild(host);

  const rendered = renderCase(host, subject, variant);
  const snapshot = normalize(
    collect(rendered.container, {
      subject: { id: `fixture:${subject}`, kind: 'fixture' },
      viewport: CORPUS_VIEWPORT,
      engine: 'jsdom@corpus',
      fonts: CORPUS_FONTS,
      portalsOf: portalContentOf,
      // Without owner chains every delta lands in `unattributed`, and the
      // one-root-per-cause claim is untestable — the differ has nothing to group
      // by. Wiring it here is what makes P2 and P3 the same measurement.
      provenanceOf,
    }),
  );

  rendered.unmount();
  host.remove();
  return snapshot;
}
