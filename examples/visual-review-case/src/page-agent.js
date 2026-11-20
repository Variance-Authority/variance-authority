import { attributeProvenance, collect } from '@variance-authority/dom';
import { AGENT_GLOBAL } from '@variance-authority/playwright/agent';
import { Plans } from './plans.js';

const variants = new Set(['before', 'after']);
const provenanceOf = attributeProvenance();

function capture(request) {
  if (request.subject !== 'plans') throw new Error(`unknown subject: ${request.subject}`);
  if (!variants.has(request.variant)) throw new Error(`unknown variant: ${request.variant}`);

  const frame = document.getElementById('frame');
  if (frame === null) throw new Error('missing #frame');

  frame.replaceChildren();
  const page = Plans(request.variant);
  frame.append(page);

  return JSON.stringify(
    collect(page, {
      subject: { id: request.subjectId, kind: 'fixture' },
      viewport: request.viewport,
      engine: request.engine,
      provenanceOf,
      fonts: request.fonts ?? [],
      assets: request.assets ?? {},
    }),
  );
}

window[AGENT_GLOBAL] = { capture, version: 'visual-review-case@1' };
