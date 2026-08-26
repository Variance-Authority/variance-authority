import { median, round } from './math.js';
import type {
  PaintInstruction,
  PresentationReport,
  PresentationSpacingAxis,
  PresentationSpacingReading,
} from './model.js';

/** Measure spacing across consecutive immediate children of one box or composition. */
export function inspectPresentationSpacing(
  report: PresentationReport,
  ownerId: string,
  members: readonly string[],
  axis: PresentationSpacingAxis,
): PresentationSpacingReading {
  const byId = new Map(report.graph.nodes.map((node) => [node.id, node]));
  const owner = byId.get(ownerId);
  if (owner === undefined) throw new Error(`presentation owner ${ownerId} is not in report ${report.digest}`);
  const uniqueMembers = [...new Set(members)];
  if (uniqueMembers.length < 2) throw new Error('presentation spacing needs at least two distinct members');
  const selected = uniqueMembers.map((id) => {
    const node = byId.get(id);
    if (node === undefined) throw new Error(`presentation spacing member ${id} is not in report ${report.digest}`);
    if (node.parent !== ownerId) {
      throw new Error(`presentation spacing member ${id} is not an immediate child of owner ${ownerId}`);
    }
    return node;
  });
  const positions = uniqueMembers.map((id) => owner.children.indexOf(id));
  const ordered = positions.every((position, index) => index === 0 || position === positions[index - 1]! + 1);
  if (!ordered) throw new Error('presentation spacing members must be consecutive in owner child order');

  const separations = selected.slice(0, -1).map((from, index) => {
    const to = selected[index + 1]!;
    const relation = report.graph.relations.find((candidate) =>
      candidate.kind === 'separates' && candidate.from === from.id && candidate.to === to.id);
    if (relation === undefined) throw new Error(`presentation spacing has no separation ${from.id} → ${to.id}`);
    const orderedOverlap = relation.axis === 'overlap' && (
      axis === 'vertical'
        ? to.rect.y >= from.rect.y
        : to.rect.x >= from.rect.x
    );
    if (relation.axis !== axis && !orderedOverlap) {
      throw new Error(`presentation spacing separation ${from.id} → ${to.id} is ${relation.axis}, not ${axis}`);
    }
    if (relation.distancePx === undefined || relation.boundaryStrength === undefined) {
      throw new Error(`presentation spacing separation ${from.id} → ${to.id} is incomplete`);
    }
    return {
      from,
      to,
      distancePx: relation.distancePx,
      boundaryStrength: relation.boundaryStrength,
      ...(relation.spacingCluster === undefined ? {} : { spacingCluster: relation.spacingCluster }),
    };
  });
  const distances = separations.map((separation) => separation.distancePx);
  const boundaries = separations.map((separation) => separation.boundaryStrength);
  return {
    formatVersion: 1,
    report: report.digest,
    owner,
    axis,
    members: selected,
    separations,
    distance: pixelRange(distances),
    boundary: scalarRange(boundaries),
    paint: separations.map((separation) => paint(ownerId, axis, separation)),
  };
}

function pixelRange(values: readonly number[]): {
  readonly minPx: number;
  readonly medianPx: number;
  readonly maxPx: number;
} {
  return {
    minPx: round(Math.min(...values), 2),
    medianPx: round(median(values)!, 2),
    maxPx: round(Math.max(...values), 2),
  };
}

function scalarRange(values: readonly number[]): {
  readonly min: number;
  readonly median: number;
  readonly max: number;
} {
  return {
    min: round(Math.min(...values)),
    median: round(median(values)!),
    max: round(Math.max(...values)),
  };
}

function paint(
  owner: string,
  axis: PresentationSpacingAxis,
  separation: PresentationSpacingReading['separations'][number],
): PaintInstruction {
  const label = `${separation.distancePx}px · boundary ${separation.boundaryStrength}`;
  const id = `spacing:${separation.from.id}:${separation.to.id}`;
  if (axis === 'vertical') {
    const coordinate = round((separation.from.rect.y + separation.from.rect.height + separation.to.rect.y) / 2, 2);
    return {
      id,
      owner,
      nodes: [separation.from.id, separation.to.id],
      layer: 'spacing',
      shape: 'line',
      color: '#ffca55',
      label,
      line: {
        x1: Math.min(separation.from.rect.x, separation.to.rect.x),
        y1: coordinate,
        x2: Math.max(
          separation.from.rect.x + separation.from.rect.width,
          separation.to.rect.x + separation.to.rect.width,
        ),
        y2: coordinate,
      },
    };
  }
  const coordinate = round((separation.from.rect.x + separation.from.rect.width + separation.to.rect.x) / 2, 2);
  return {
    id,
    owner,
    nodes: [separation.from.id, separation.to.id],
    layer: 'spacing',
    shape: 'line',
    color: '#ffca55',
    label,
    line: {
      x1: coordinate,
      y1: Math.min(separation.from.rect.y, separation.to.rect.y),
      x2: coordinate,
      y2: Math.max(
        separation.from.rect.y + separation.from.rect.height,
        separation.to.rect.y + separation.to.rect.height,
      ),
    },
  };
}
