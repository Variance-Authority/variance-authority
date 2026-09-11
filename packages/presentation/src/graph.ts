import type { RawCapture, RawNode, Rect } from '@variance-authority/core/format';
import type {
  PresentationNode,
  PresentationRelation,
  SurfaceEvidence,
  TypographyEvidence,
} from './model.js';
import {
  colorOf,
  luminance,
  numeric,
  opaque,
  perceptualDifference,
  round,
  stableEntries,
} from './math.js';

export interface BuiltGraph {
  readonly nodes: PresentationNode[];
  readonly relations: PresentationRelation[];
  readonly byId: Map<string, PresentationNode>;
  readonly rawById: Map<string, RawNode>;
}

export function buildGraph(capture: RawCapture): BuiltGraph {
  const nodes: PresentationNode[] = [];
  const relations: PresentationRelation[] = [];
  const byId = new Map<string, PresentationNode>();
  const rawById = new Map<string, RawNode>();
  const roots = [capture.root, ...(capture.portals ?? [])];

  roots.forEach((root, rootIndex) => walk(root, rootIndex, '0', undefined, '#ffffff'));
  return { nodes, relations, byId, rawById };

  function walk(
    raw: RawNode,
    root: number,
    path: string,
    parent: string | undefined,
    containingFill: string,
  ): string | undefined {
    if (raw.tag === '#text') return undefined;
    const rect = raw.rect;
    const style = raw.computedStyle ?? raw.inlineStyle ?? {};
    const fill = opaque(style['background-color']);
    const effectiveFill = fill ?? containingFill;
    const id = `r${root}:${path}`;
    const childIds: string[] = [];
    raw.children.forEach((child, index) => {
      const childId = walk(child, root, `${path}/${index}`, id, effectiveFill);
      if (childId !== undefined) childIds.push(childId);
    });
    raw.shadowChildren?.forEach((child, index) => {
      const childId = walk(child, root, `${path}/shadow:${index}`, id, effectiveFill);
      if (childId !== undefined) childIds.push(childId);
    });
    if (rect === undefined || rect.width <= 0 || rect.height <= 0) return undefined;

    const typography = typographyOf(style);
    const surface = surfaceOf(style, fill, containingFill);
    const text = textOf(raw);
    const semanticClass = semanticClassOf(raw);
    const state = raw.aria?.state ?? {};
    const area = Math.max(1, rect.width * rect.height);
    const magnitude = prominenceMagnitude(typography, surface, area);
    const node: PresentationNode = {
      id,
      ref: { root, path },
      ...(parent === undefined ? {} : { parent }),
      children: childIds,
      tag: raw.tag,
      semanticClass,
      ...(raw.aria?.role ? { role: raw.aria.role } : {}),
      ...(raw.aria?.name ? { name: raw.aria.name } : {}),
      ...(text.length > 0 ? { text } : {}),
      state,
      stateSignature: stableEntries(state),
      rect,
      typography,
      surface,
      prominence: { magnitude },
    };
    nodes.push(node);
    byId.set(id, node);
    rawById.set(id, raw);
    if (parent !== undefined) {
      relations.push({ id: `contains:${parent}:${id}`, kind: 'contains', from: parent, to: id });
    }
    return id;
  }
}

function typographyOf(style: Readonly<Record<string, string>>): TypographyEvidence {
  const sizePx = numeric(style['font-size']);
  const lineHeight = numeric(style['line-height']);
  const weightText = style['font-weight'];
  const namedWeight = weightText === 'bold' ? 700 : weightText === 'normal' ? 400 : undefined;
  const weight = namedWeight ?? numeric(weightText);
  return {
    ...(style['font-family'] === undefined ? {} : { family: style['font-family'] }),
    ...(sizePx === undefined ? {} : { sizePx }),
    ...(weight === undefined ? {} : { weight }),
    ...(style['font-style'] === undefined ? {} : { style: style['font-style'] }),
    ...(sizePx === undefined ? {} : { lineHeightPx: lineHeight ?? round(sizePx * 1.2, 2) }),
    ...(style.color === undefined ? {} : { foreground: style.color }),
  };
}

function surfaceOf(
  style: Readonly<Record<string, string>>,
  fill: string | undefined,
  containingFill: string,
): SurfaceEvidence {
  const borderWidthPx = Math.max(
    ...['top', 'right', 'bottom', 'left'].map((side) => {
      const width = numeric(style[`border-${side}-width`]) ?? 0;
      const kind = style[`border-${side}-style`];
      const color = colorOf(style[`border-${side}-color`]);
      return kind !== undefined && kind !== 'none' && color !== undefined && color.alpha > 0.01
        ? width
        : 0;
    }),
  );
  const shadow = style['box-shadow'] !== undefined && style['box-shadow'] !== 'none';
  const difference = fill === undefined ? undefined : perceptualDifference(fill, containingFill);
  return {
    ...(fill === undefined ? {} : { fill }),
    containingFill,
    ...(difference === undefined ? {} : { perceptualDifference: difference }),
    borderWidthPx,
    shadow,
  };
}

function prominenceMagnitude(
  typography: TypographyEvidence,
  surface: SurfaceEvidence,
  area: number,
): number {
  const size = typography.sizePx ?? 16;
  const weight = typography.weight ?? 400;
  const darkness = 1 - (luminance(typography.foreground) ?? 0.5);
  const surfaceLift = surface.fill === undefined ? 0 : 0.25;
  const borderLift = surface.borderWidthPx > 0 || surface.shadow ? 0.15 : 0;
  return round(Math.log2(Math.max(1, size)) + weight / 1000 + darkness * 0.25 + Math.log10(area) * 0.05 + surfaceLift + borderLift);
}

function textOf(node: RawNode): string {
  const parts: string[] = [];
  collect(node);
  return parts.join(' ').replace(/\s+/g, ' ').trim();

  function collect(current: RawNode): void {
    if (current.tag === '#text') {
      if (current.text !== undefined) parts.push(current.text);
      return;
    }
    for (const child of current.children) collect(child);
    for (const child of current.shadowChildren ?? []) collect(child);
  }
}

function semanticClassOf(node: RawNode): string {
  const role = node.aria?.role;
  if (role === 'heading') {
    const level = node.attributes['aria-level'] ?? /^h([1-6])$/.exec(node.tag)?.[1];
    return level === undefined ? 'heading' : `heading:${level}`;
  }
  if (role !== null && role !== undefined) return role;
  if (node.tag === 'label') return 'label';
  if (/^h[1-6]$/.test(node.tag)) return `heading:${node.tag.slice(1)}`;
  if (node.tag === 'p') return 'paragraph';
  if (node.tag === 'li') return 'listitem';
  if (node.tag === 'section' || node.tag === 'article') return 'region';
  return node.tag;
}

export function center(rect: Rect): readonly [number, number] {
  return [rect.x + rect.width / 2, rect.y + rect.height / 2];
}
