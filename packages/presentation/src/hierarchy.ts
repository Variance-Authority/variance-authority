import { codeUnitCompare, median, round } from './math.js';
import type {
  PaintInstruction,
  PresentationFinding,
  PresentationHierarchyContract,
  PresentationHierarchyReading,
  PresentationHierarchyRole,
  PresentationNode,
  PresentationRelation,
  PresentationReport,
} from './model.js';

const ROLE_ORDER: Readonly<Record<PresentationHierarchyRole, number>> = {
  'owner-boundary': 0,
  'leading-to-body': 1,
  'body-peer': 2,
  'content-internal': 3,
};
const RELATIONSHIP_RATIO = 1.15;
const COLORS = ['#00d4ff', '#ff2bd6', '#ffe600', '#70ff70'] as const;

/** Evaluate product-declared hierarchy roles without treating token use as authorization. */
export function inspectPresentationHierarchy(
  report: PresentationReport,
  contract: PresentationHierarchyContract,
): PresentationHierarchyReading {
  if (contract.id.trim().length === 0) throw new Error('presentation hierarchy contract needs an id');
  if (contract.levels.length < 2) throw new Error('presentation hierarchy needs at least two relationship levels');
  const byId = new Map(report.graph.nodes.map((node) => [node.id, node]));
  const owner = byId.get(contract.owner);
  if (owner === undefined) {
    throw new Error(`presentation hierarchy owner ${contract.owner} is not in report ${report.digest}`);
  }
  const roles = contract.levels.map((level) => level.role);
  if (new Set(roles).size !== roles.length) throw new Error('presentation hierarchy roles must be distinct');
  if (!roles.every((role, index) => index === 0 || ROLE_ORDER[role] > ROLE_ORDER[roles[index - 1]!]!)) {
    throw new Error('presentation hierarchy roles must be ordered outside-in');
  }
  const descendants = new Set([owner.id, ...descendantIds(owner, byId)]);
  const relationByPair = new Map(report.graph.relations
    .filter((relation) => relation.kind === 'separates')
    .map((relation) => [`${relation.from}\0${relation.to}`, relation]));
  const seenPairs = new Set<string>();
  const levels = contract.levels.map((level) => {
    if (level.relations.length === 0) {
      throw new Error(`presentation hierarchy role ${level.role} needs at least one relationship`);
    }
    const separations = level.relations.map(({ from, to }) => {
      const key = `${from}\0${to}`;
      if (seenPairs.has(key)) throw new Error(`presentation hierarchy relationship ${from} → ${to} has two roles`);
      seenPairs.add(key);
      const fromNode = byId.get(from);
      const toNode = byId.get(to);
      if (fromNode === undefined || toNode === undefined) {
        throw new Error(`presentation hierarchy relationship ${from} → ${to} is not in report ${report.digest}`);
      }
      if (!descendants.has(from) || !descendants.has(to)) {
        throw new Error(`presentation hierarchy relationship ${from} → ${to} is outside owner ${owner.id}`);
      }
      const relation = relationByPair.get(key);
      if (relation === undefined) throw new Error(`presentation hierarchy has no separation ${from} → ${to}`);
      assertAxis(contract, relation, fromNode, toNode);
      if (relation.distancePx === undefined || relation.boundaryStrength === undefined) {
        throw new Error(`presentation hierarchy separation ${from} → ${to} is incomplete`);
      }
      return {
        from: fromNode,
        to: toNode,
        distancePx: relation.distancePx,
        boundaryStrength: relation.boundaryStrength,
        ...(relation.spacingCluster === undefined ? {} : { spacingCluster: relation.spacingCluster }),
      };
    });
    const clusters = [...new Set(separations.flatMap((separation) => separation.spacingCluster ?? []))]
      .sort(codeUnitCompare);
    return {
      role: level.role,
      separations,
      distanceMedianPx: round(median(separations.map((separation) => separation.distancePx))!, 2),
      boundaryMedian: round(median(separations.map((separation) => separation.boundaryStrength))!),
      spacingClusters: clusters,
    };
  });
  const collisions = levels.slice(0, -1).flatMap((outer, index) => {
    const inner = levels[index + 1]!;
    const sharedSpacingClusters = outer.spacingClusters.filter((cluster) => inner.spacingClusters.includes(cluster));
    const smaller = Math.min(outer.distanceMedianPx, inner.distanceMedianPx);
    const larger = Math.max(outer.distanceMedianPx, inner.distanceMedianPx);
    const ratio = smaller === 0 ? (larger === 0 ? 1 : Number.POSITIVE_INFINITY) : larger / smaller;
    if (sharedSpacingClusters.length === 0 && ratio > RELATIONSHIP_RATIO) return [];
    return [{
      outer: outer.role,
      inner: inner.role,
      outerMedianPx: outer.distanceMedianPx,
      innerMedianPx: inner.distanceMedianPx,
      ratio: round(ratio),
      sharedSpacingClusters,
    }];
  });
  const findings: PresentationFinding[] = collisions.map((collision, index) => ({
    id: `H${index + 1}`,
    rule: 'SPACING_HIERARCHY_COLLISION',
    owner: owner.id,
    nodes: nodesForCollision(levels, collision.outer, collision.inner),
    contract: contract.id,
    measurements: {
      outerRole: collision.outer,
      innerRole: collision.inner,
      outerMedianPx: collision.outerMedianPx,
      innerMedianPx: collision.innerMedianPx,
      ratio: collision.ratio,
      sharedSpacingClusters: collision.sharedSpacingClusters.join(','),
    },
  }));
  return {
    formatVersion: 1,
    report: report.digest,
    contract,
    owner,
    levels,
    collisions,
    findings,
    paint: paint(contract, levels, collisions),
  };
}

function assertAxis(
  contract: PresentationHierarchyContract,
  relation: PresentationRelation,
  from: PresentationNode,
  to: PresentationNode,
): void {
  const orderedOverlap = relation.axis === 'overlap' && (
    contract.axis === 'vertical' ? to.rect.y >= from.rect.y : to.rect.x >= from.rect.x
  );
  if (relation.axis !== contract.axis && !orderedOverlap) {
    throw new Error(
      `presentation hierarchy separation ${from.id} → ${to.id} is ${relation.axis}, not ${contract.axis}`,
    );
  }
}

function nodesForCollision(
  levels: PresentationHierarchyReading['levels'],
  outer: PresentationHierarchyRole,
  inner: PresentationHierarchyRole,
): string[] {
  return [...new Set(levels
    .filter((level) => level.role === outer || level.role === inner)
    .flatMap((level) => level.separations.flatMap((separation) => [separation.from.id, separation.to.id])))]
    .sort(codeUnitCompare);
}

function paint(
  contract: PresentationHierarchyContract,
  levels: PresentationHierarchyReading['levels'],
  collisions: PresentationHierarchyReading['collisions'],
): PaintInstruction[] {
  const collided = new Set(collisions.flatMap((collision) => [collision.outer, collision.inner]));
  return levels.flatMap((level, levelIndex) => level.separations.map((separation, relationIndex) => {
    const horizontal = contract.axis === 'vertical';
    const coordinate = horizontal
      ? round((separation.from.rect.y + separation.from.rect.height + separation.to.rect.y) / 2, 2)
      : round((separation.from.rect.x + separation.from.rect.width + separation.to.rect.x) / 2, 2);
    return {
      id: `hierarchy:${contract.id}:${level.role}:${relationIndex + 1}`,
      owner: contract.owner,
      nodes: [separation.from.id, separation.to.id],
      contract: contract.id,
      layer: 'findings' as const,
      shape: 'line' as const,
      color: collided.has(level.role) ? '#ff1744' : COLORS[levelIndex]!,
      label: `${level.role} ${separation.distancePx}px`,
      line: horizontal
        ? {
            x1: Math.min(separation.from.rect.x, separation.to.rect.x),
            y1: coordinate,
            x2: Math.max(
              separation.from.rect.x + separation.from.rect.width,
              separation.to.rect.x + separation.to.rect.width,
            ),
            y2: coordinate,
          }
        : {
            x1: coordinate,
            y1: Math.min(separation.from.rect.y, separation.to.rect.y),
            x2: coordinate,
            y2: Math.max(
              separation.from.rect.y + separation.from.rect.height,
              separation.to.rect.y + separation.to.rect.height,
            ),
          },
    };
  }));
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
