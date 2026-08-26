import type { RawCapture, RawNode } from '@variance-authority/core';
import type { PresentationNode, PresentationTelemetry, RepeatedPattern } from './model.js';
import { round, unionArea } from './math.js';

export function telemetryOf(
  capture: RawCapture,
  nodes: readonly PresentationNode[],
  patterns: readonly RepeatedPattern[] | undefined,
): PresentationTelemetry {
  const census = censusOf([capture.root, ...(capture.portals ?? [])]);
  const root = nodes.find((node) => node.id === 'r0:0');
  const repeatedObjects = patterns?.reduce((total, pattern) => total + pattern.instances.length, 0) ?? 0;
  const content = {
    elements: census.elements,
    characters: census.characters,
    estimatedLines: estimateLines(nodes),
    controls: census.controls,
    repeatedObjects,
  };
  if (root === undefined) return { content };

  const viewport = capture.environment.viewport;
  const viewportHeights = root.rect.height / Math.max(1, viewport.height);
  const leafRects = nodes
    .filter((node) => node.children.length === 0)
    .map((node) => node.rect);
  const regionArea = Math.max(1, root.rect.width * root.rect.height);
  const occupied = unionArea(leafRects);
  return {
    content,
    dimensions: {
      regionWidthPx: root.rect.width,
      regionHeightPx: root.rect.height,
      viewportWidthPx: viewport.width,
      viewportHeightPx: viewport.height,
      viewportHeights: round(viewportHeights, 2),
    },
    utilization: {
      horizontal: round(root.rect.width / Math.max(1, viewport.width)),
      occupiedArea: round(occupied / regionArea),
    },
    density: {
      charactersPer1000Px2: round((census.characters / regionArea) * 1000),
      linesPerViewport: round(content.estimatedLines / Math.max(1, viewportHeights)),
      controlsPerViewport: round(census.controls / Math.max(1, viewportHeights)),
      repeatedObjectsPerViewport: round(repeatedObjects / Math.max(1, viewportHeights)),
    },
  };
}

function censusOf(roots: readonly RawNode[]): {
  readonly elements: number;
  readonly characters: number;
  readonly controls: number;
} {
  let elements = 0;
  let characters = 0;
  let controls = 0;
  const controlRoles = new Set(['button', 'checkbox', 'combobox', 'link', 'menuitem', 'radio', 'slider', 'spinbutton', 'switch', 'tab', 'textbox']);
  for (const root of roots) walk(root);
  return { elements, characters, controls };

  function walk(node: RawNode): void {
    if (node.tag === '#text') characters += node.text?.replace(/\s+/g, ' ').trim().length ?? 0;
    else {
      elements += 1;
      if (node.aria?.role !== null && node.aria?.role !== undefined && controlRoles.has(node.aria.role)) controls += 1;
    }
    for (const child of node.children) walk(child);
    for (const child of node.shadowChildren ?? []) walk(child);
  }
}

function estimateLines(nodes: readonly PresentationNode[]): number {
  return nodes
    .filter((node) => node.children.length === 0 && (node.text !== undefined || node.name !== undefined))
    .reduce((total, node) => {
      const lineHeight = node.typography.lineHeightPx ?? node.typography.sizePx ?? node.rect.height;
      return total + Math.max(1, Math.round(node.rect.height / Math.max(1, lineHeight)));
    }, 0);
}
