import { codeUnitCompare, median, round } from './math.js';
import type {
  PresentationAlignmentKind,
  PresentationAlignmentReading,
  PresentationNode,
  PresentationReport,
} from './model.js';

/**
 * Measure an explicitly chosen visual flow, including peers nested in different boxes.
 *
 * Selection remains with the product-aware caller. The reading supplies coordinates
 * and deviations without converting their spread into a design verdict.
 */
export function inspectPresentationAlignment(
  report: PresentationReport,
  ownerId: string,
  members: readonly string[],
  kind: PresentationAlignmentKind,
): PresentationAlignmentReading {
  const byId = new Map(report.graph.nodes.map((node) => [node.id, node]));
  const owner = byId.get(ownerId);
  if (owner === undefined) throw new Error(`presentation owner ${ownerId} is not in report ${report.digest}`);
  const uniqueMembers = [...new Set(members)].sort(codeUnitCompare);
  if (uniqueMembers.length < 2) throw new Error('presentation alignment needs at least two distinct members');
  const descendants = new Set(descendantIds(owner, byId));
  const selected = uniqueMembers.map((id) => {
    const node = byId.get(id);
    if (node === undefined) throw new Error(`presentation alignment member ${id} is not in report ${report.digest}`);
    if (!descendants.has(id)) throw new Error(`presentation alignment member ${id} is not inside owner ${ownerId}`);
    return node;
  });
  const values = selected.map((node) => coordinate(node, kind));
  const center = median(values)!;
  const membersWithCoordinates = selected.map((node) => {
    const coordinatePx = coordinate(node, kind);
    return { node, coordinatePx: round(coordinatePx, 2), deviationPx: round(coordinatePx - center, 2) };
  });
  const horizontal = ['top', 'bottom', 'vertical-center'].includes(kind);
  const readingId = `alignment:${kind}:${uniqueMembers.join('+')}`;
  return {
    formatVersion: 1,
    report: report.digest,
    owner,
    kind,
    coordinatePx: round(center, 2),
    spreadPx: round(Math.max(...values) - Math.min(...values), 2),
    members: membersWithCoordinates,
    paint: [
      {
        id: readingId,
        owner: ownerId,
        nodes: uniqueMembers,
        layer: 'axes',
        shape: 'line',
        color: '#70ff70',
        label: `${kind} ${round(center, 2)}px`,
        line: horizontal
          ? {
              x1: Math.min(...selected.map((node) => node.rect.x)),
              y1: round(center, 2),
              x2: Math.max(...selected.map((node) => node.rect.x + node.rect.width)),
              y2: round(center, 2),
            }
          : {
              x1: round(center, 2),
              y1: Math.min(...selected.map((node) => node.rect.y)),
              x2: round(center, 2),
              y2: Math.max(...selected.map((node) => node.rect.y + node.rect.height)),
            },
      },
      ...membersWithCoordinates.map(({ node, coordinatePx, deviationPx }) => ({
        id: `${readingId}:${node.id}`,
        owner: ownerId,
        nodes: [node.id],
        layer: 'axes' as const,
        shape: 'rect' as const,
        color: '#70ff70',
        label: `${coordinatePx}px (${deviationPx >= 0 ? '+' : ''}${deviationPx}px)`,
        rect: node.rect,
      })),
    ],
  };
}

function coordinate(node: PresentationNode, kind: PresentationAlignmentKind): number {
  if (kind === 'left') return node.rect.x;
  if (kind === 'right') return node.rect.x + node.rect.width;
  if (kind === 'horizontal-center') return node.rect.x + node.rect.width / 2;
  if (kind === 'top') return node.rect.y;
  if (kind === 'bottom') return node.rect.y + node.rect.height;
  return node.rect.y + node.rect.height / 2;
}

function descendantIds(owner: PresentationNode, byId: ReadonlyMap<string, PresentationNode>): string[] {
  const result: string[] = [];
  for (const id of owner.children) {
    const child = byId.get(id);
    if (child === undefined) continue;
    result.push(id, ...descendantIds(child, byId));
  }
  return result;
}
