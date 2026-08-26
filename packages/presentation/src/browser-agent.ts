import { recipeOf } from '@variance-authority/core';
import type { Digest, RawCapture, SubjectRef, Viewport } from '@variance-authority/core';
import { collect, stabilizeForObservation } from '@variance-authority/dom';
import { awaitSuspense, portalContentOf, provenanceOf } from '@variance-authority/react';
import type { PaintInstruction, PaintLayer } from './model.js';

export const PRESENTATION_AGENT = '__variance_authority_presentation__';
export const PRESENTATION_AGENT_VERSION = 'presentation@0';
export const PRESENTATION_ROOT_ATTRIBUTE = 'data-variance-authority-presentation-root';
export const PRESENTATION_OVERLAY_ATTRIBUTE = 'data-variance-authority-presentation-overlay';
let sequence = 0;

export interface PresentationAcquireRequest {
  readonly subject: SubjectRef;
  readonly viewport: Viewport;
  readonly engine: string;
  readonly fonts?: readonly string[];
  readonly stabilize?: readonly string[];
  readonly suspense?: { readonly timeoutMs?: number };
}

export interface PresentationAcquired {
  readonly capture: RawCapture;
  readonly stabilization: { readonly ids: readonly string[]; readonly digest?: Digest };
  readonly portals: readonly { readonly marker: string; readonly previous?: string }[];
}

export interface InstalledPresentationAgent {
  readonly acquire: (root: Element, request: PresentationAcquireRequest) => Promise<string>;
  readonly paint: (instructions: readonly PaintInstruction[], layers?: readonly PaintLayer[]) => number;
  readonly clear: () => void;
  readonly version: string;
}

export async function acquirePresentation(
  root: Element,
  request: PresentationAcquireRequest,
): Promise<string> {
  clearPresentationPaint();
  await awaitSuspense(root, request.suspense ?? {});
  const held = await stabilizeForObservation(
    root.ownerDocument,
    request.stabilize === undefined ? {} : { recipe: recipeOf(request.stabilize) },
  );
  const portalRoots = portalContentOf(root);
  const capture = collect(root, {
    subject: request.subject,
    viewport: request.viewport,
    engine: request.engine,
    portalsOf: () => portalRoots,
    provenanceOf,
    ...(request.fonts === undefined ? {} : { fonts: request.fonts }),
    ...(held.digest === undefined ? {} : { stabilization: held.digest }),
  });
  const current = ++sequence;
  const portals = portalRoots.map((portal, index) => {
    const previous = portal.getAttribute(PRESENTATION_ROOT_ATTRIBUTE);
    const marker = `${current}-${index}`;
    portal.setAttribute(PRESENTATION_ROOT_ATTRIBUTE, marker);
    return { marker, ...(previous === null ? {} : { previous }) };
  });
  return JSON.stringify({
    capture,
    stabilization: {
      ids: held.ids,
      ...(held.digest === undefined ? {} : { digest: held.digest }),
    },
    portals,
  });
}

export function paintPresentation(
  instructions: readonly PaintInstruction[],
  layers?: readonly PaintLayer[],
): number {
  clearPresentationPaint();
  const selected = layers === undefined ? undefined : new Set(layers);
  const visible = instructions.filter((instruction) => selected?.has(instruction.layer) ?? true);
  if (visible.length === 0) return 0;
  const document = globalThis.document;
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute(PRESENTATION_OVERLAY_ATTRIBUTE, '');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', String(Math.max(document.documentElement.scrollWidth, innerWidth)));
  svg.setAttribute('height', String(Math.max(document.documentElement.scrollHeight, innerHeight)));
  Object.assign(svg.style, {
    position: 'absolute', left: '0', top: '0', pointerEvents: 'none',
    overflow: 'visible', zIndex: '2147483647',
  });

  for (const instruction of visible) {
    const group = document.createElementNS(namespace, 'g');
    group.setAttribute('data-layer', instruction.layer);
    group.setAttribute('data-measurement', instruction.id);
    if (instruction.shape === 'rect' && instruction.rect !== undefined) {
      const rectangle = document.createElementNS(namespace, 'rect');
      rectangle.setAttribute('x', String(instruction.rect.x + scrollX));
      rectangle.setAttribute('y', String(instruction.rect.y + scrollY));
      rectangle.setAttribute('width', String(instruction.rect.width));
      rectangle.setAttribute('height', String(instruction.rect.height));
      rectangle.setAttribute('fill', 'none');
      rectangle.setAttribute('stroke', instruction.color);
      rectangle.setAttribute('stroke-width', instruction.layer === 'findings' ? '3' : '1');
      rectangle.setAttribute('stroke-dasharray', instruction.layer === 'semantic' ? '3 2' : 'none');
      group.append(rectangle);
      group.append(paintLabel(instruction.label, instruction.rect.x + scrollX + 2, instruction.rect.y + scrollY + 11));
    } else if (instruction.shape === 'line' && instruction.line !== undefined) {
      const line = document.createElementNS(namespace, 'line');
      line.setAttribute('x1', String(instruction.line.x1 + scrollX));
      line.setAttribute('y1', String(instruction.line.y1 + scrollY));
      line.setAttribute('x2', String(instruction.line.x2 + scrollX));
      line.setAttribute('y2', String(instruction.line.y2 + scrollY));
      line.setAttribute('stroke', instruction.color);
      group.append(line);
      group.append(paintLabel(
        instruction.label,
        (instruction.line.x1 + instruction.line.x2) / 2 + scrollX,
        (instruction.line.y1 + instruction.line.y2) / 2 + scrollY,
      ));
    }
    svg.append(group);
  }
  document.documentElement.append(svg);
  return visible.length;
}

export function clearPresentationPaint(): void {
  globalThis.document?.querySelector(`[${PRESENTATION_OVERLAY_ATTRIBUTE}]`)?.remove();
}

function paintLabel(text: string, x: number, y: number): SVGTextElement {
  const value = document.createElementNS('http://www.w3.org/2000/svg', 'text');
  value.setAttribute('x', String(x));
  value.setAttribute('y', String(y));
  value.setAttribute('fill', '#111');
  value.setAttribute('stroke', '#fff');
  value.setAttribute('stroke-width', '3');
  value.setAttribute('paint-order', 'stroke');
  value.setAttribute('font-family', 'ui-monospace, monospace');
  value.setAttribute('font-size', '10');
  value.textContent = text;
  return value;
}
