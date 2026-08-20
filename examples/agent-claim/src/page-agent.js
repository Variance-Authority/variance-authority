import { acquireDocument, attributeProvenance, collect } from '@variance-authority/dom';
import { AGENT_GLOBAL } from '@variance-authority/playwright/agent';
import { SUBJECTS } from './system.js';

/**
 * The browser half: mount one subject at one revision, and read it twice.
 *
 * `acquire` returns both products of **one** mount — the `RenderDocument` the
 * raster tier paints and the `RawCapture` the semantic tier normalizes. Two
 * mounts would be two renders, and any disagreement between the image and the
 * names attached to it would become a story about which of them was looking at
 * what.
 *
 * Provenance comes from `data-component` attributes rather than from a framework
 * adapter, so this example has no framework in it and the report still names the
 * component that moved. That is the whole interface attribution needs: a name on
 * an element.
 */

const provenanceOf = attributeProvenance();

function mount(subjectId, revision) {
  const render = SUBJECTS[subjectId];
  if (render === undefined) throw new Error(`unknown subject: ${subjectId}`);
  if (revision !== 'before' && revision !== 'after') {
    throw new Error(`unknown revision: ${revision}`);
  }

  const frame = document.getElementById('frame');
  if (frame === null) throw new Error('missing #frame');

  frame.replaceChildren();
  const root = render(revision);
  frame.append(root);
  return root;
}

function acquire(request) {
  const root = mount(request.subjectId, request.revision);
  const subject = { id: request.subjectId, kind: 'fixture' };
  const shared = {
    subject,
    viewport: request.viewport,
    fonts: request.fonts ?? [],
  };

  return JSON.stringify({
    document: acquireDocument(root, shared),
    capture: collect(root, {
      ...shared,
      engine: request.engine,
      provenanceOf,
      // Declared, not defaulted. This system renders nothing through a portal,
      // and saying so is a different statement from staying silent — silence
      // makes a subject whose modal is open byte-identical to one whose modal is
      // closed, and the run reports `portals-not-resolved` rather than guessing.
      portalsOf: () => [],
      assets: {},
    }),
  });
}

window[AGENT_GLOBAL] = {
  version: 'agent-claim@1',
  acquire,
  // The `PageAgent` contract, implemented in terms of `acquire` rather than
  // beside it, so there is no arrangement in which the two read different DOM.
  capture: (request) =>
    JSON.stringify(
      JSON.parse(
        acquire({
          subjectId: request.subjectId,
          revision: request.variant,
          viewport: request.viewport,
          engine: request.engine,
          fonts: request.fonts,
        }),
      ).capture,
    ),
};
