import { collect } from '@variance-authority/dom';
import { AGENT_GLOBAL, type CaptureRequest, type PageAgent } from '@variance-authority/playwright/agent';
import { provenanceOf } from '@variance-authority/react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { ProductCard } from './product-card.js';

const variants = new Set(['before', 'after']);
let root: Root | undefined;

function capture(request: CaptureRequest): string {
  if (!variants.has(request.variant)) throw new Error(`unknown variant: ${request.variant}`);

  const host = document.getElementById('subject');
  if (host === null) throw new Error('missing #subject');
  root?.unmount();
  root = createRoot(host);
  flushSync(() => root!.render(<ProductCard active={request.variant === 'after'} />));

  return JSON.stringify(
    collect(host, {
      subject: { id: request.subjectId, kind: 'fixture' },
      viewport: request.viewport,
      engine: request.engine,
      provenanceOf,
      fonts: request.fonts ?? [],
      assets: request.assets ?? {},
    }),
  );
}

(window as unknown as Record<string, PageAgent>)[AGENT_GLOBAL] = { capture, version: 'dynamic-route-flake@1' };
