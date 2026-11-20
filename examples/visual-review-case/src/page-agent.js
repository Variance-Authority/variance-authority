import { acquireDocument, attributeProvenance, collect } from '@variance-authority/dom';
import { AGENT_GLOBAL } from '@variance-authority/playwright/agent';
import { Plans } from './plans.js';

const variants = new Set(['before', 'after']);
const provenanceOf = attributeProvenance();

/**
 * Mount one variant and read it twice from the one mount, as the shipped
 * collectors' agents do: the document the renderer repaints, and the snapshot
 * the comparison names components from.
 */
function acquire(request) {
  if (request.subject !== 'plans') throw new Error(`unknown subject: ${request.subject}`);
  if (!variants.has(request.variant)) throw new Error(`unknown variant: ${request.variant}`);

  const frame = document.getElementById('frame');
  if (frame === null) throw new Error('missing #frame');

  frame.replaceChildren();
  const root = Plans(request.variant);
  frame.append(root);

  const shared = {
    subject: { id: request.subjectId, kind: 'fixture' },
    viewport: request.viewport,
    fonts: request.fonts ?? [],
    assets: request.assets ?? {},
  };
  const acquired = { ...acquireDocument(root, shared), baseUrl: root.ownerDocument.baseURI };
  const capture = collect(root, {
    ...shared,
    engine: request.engine,
    provenanceOf,
    // The cards render nothing through a portal, so there is none to resolve.
    portalsOf: () => [],
  });

  return JSON.stringify({ document: acquired, capture });
}

window[AGENT_GLOBAL] = { acquire, version: 'visual-review-case@2' };
