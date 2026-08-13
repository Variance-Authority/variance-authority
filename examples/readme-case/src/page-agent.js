import { attributeProvenance, collect } from '@variance-authority/dom';
import { AGENT_GLOBAL } from '@variance-authority/playwright/agent';
import { Button } from './Button.js';

const variants = new Set(['before', 'after']);
const provenanceOf = attributeProvenance();

function capture(request) {
  if (request.subject !== 'button') throw new Error(`unknown subject: ${request.subject}`);
  if (!variants.has(request.variant)) throw new Error(`unknown variant: ${request.variant}`);

  const frame = document.getElementById('frame');
  if (frame === null) throw new Error('missing #frame');

  frame.replaceChildren();
  const button = Button(request.variant);
  frame.append(button);

  return JSON.stringify(
    collect(button, {
      subject: { id: request.subjectId, kind: 'fixture' },
      viewport: request.viewport,
      engine: request.engine,
      provenanceOf,
      fonts: request.fonts ?? [],
      assets: request.assets ?? {},
    }),
  );
}

window[AGENT_GLOBAL] = { capture, version: 'readme-case@1' };
