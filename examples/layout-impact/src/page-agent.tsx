import { collect } from '@variance-authority/dom';
import { AGENT_GLOBAL, type CaptureRequest, type PageAgent } from '@variance-authority/playwright/agent';
import { provenanceOf } from '@variance-authority/react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { Workspace, type Variant } from './workspace.js';

const variants = new Set<Variant>(['base', 'heading-style', 'layout', 'structure']);
let root: Root | undefined;

const BASE_CSS = [
  '.workspace-heading { color: #24292f; }',
  '.workspace-sidebar { width: 200px; }',
  '.workspace-action { height: 36px; padding: 0 12px; }',
].join('\n');

function installVariant(variant: Variant): void {
  let style = document.getElementById('workspace-variant') as HTMLStyleElement | null;
  if (style === null) {
    style = document.createElement('style');
    style.id = 'workspace-variant';
    document.head.append(style);
  }
  const change = variant === 'heading-style'
    ? '.workspace-heading { color: #8250df; }'
    : variant === 'layout'
      ? '.workspace-sidebar { width: 250px; }\n.workspace-action { height: 40px; }'
      : '';
  style.textContent = `${BASE_CSS}\n${change}`;
}

function capture(request: CaptureRequest): string {
  if (!variants.has(request.variant as Variant)) throw new Error(`unknown variant: ${request.variant}`);
  const host = document.getElementById('subject');
  if (host === null) throw new Error('missing #subject');
  root ??= createRoot(host);
  const variant = request.variant as Variant;
  installVariant(variant);
  flushSync(() => root!.render(<Workspace structural={variant === 'structure'} />));
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

(window as unknown as Record<string, PageAgent>)[AGENT_GLOBAL] = { capture, version: 'layout-impact@1' };
