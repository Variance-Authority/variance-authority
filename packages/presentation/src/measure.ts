import type {
  AlignmentAxis,
  BaselineCluster,
  PresentationNode,
  PresentationRelation,
  ProminenceCluster,
  SpacingCluster,
  SurfaceGroup,
} from './model.js';
import type { BuiltGraph } from './graph.js';
import { codeUnitCompare, gapBetween, median, round } from './math.js';

export interface Measurements {
  readonly nodes: PresentationNode[];
  readonly relations: PresentationRelation[];
  readonly spacing: SpacingCluster[];
  readonly axes: AlignmentAxis[];
  readonly baselines: BaselineCluster[];
  readonly prominence: ProminenceCluster[];
  readonly surfaces: SurfaceGroup[];
  readonly baselineByNode: ReadonlyMap<string, number>;
  readonly axisByMember: ReadonlyMap<string, readonly AlignmentAxis[]>;
}

export function measureGraph(graph: BuiltGraph): Measurements {
  const separations = siblingSeparations(graph);
  const spacing = numericClusters(
    separations.filter((relation) => (relation.distancePx ?? 0) > 0).map((relation) => relation.distancePx!),
    'S',
    (center) => Math.max(0.75, center * 0.08),
  ).map((cluster) => ({
    id: cluster.id,
    centerPx: round(cluster.center, 2),
    minPx: round(Math.min(...cluster.values), 2),
    maxPx: round(Math.max(...cluster.values), 2),
    samples: cluster.values.length,
  }));
  const withSpacing = separations.map((relation) => {
    const cluster = spacing.find(
      (candidate) =>
        relation.distancePx !== undefined &&
        relation.distancePx >= candidate.minPx - 0.01 &&
        relation.distancePx <= candidate.maxPx + 0.01,
    );
    return cluster === undefined ? relation : { ...relation, spacingCluster: cluster.id };
  });

  const axes = alignmentAxes(graph.nodes);
  const baselines = baselineClusters(graph.nodes);
  const prominence = prominenceClusters(graph.nodes);
  const surfaces = surfaceGroups(graph.nodes);
  const clusterByNode = new Map<string, string>();
  for (const cluster of prominence) for (const member of cluster.members) clusterByNode.set(member, cluster.id);
  const nodes = graph.nodes.map((node) => {
    const cluster = clusterByNode.get(node.id);
    return cluster === undefined
      ? node
      : { ...node, prominence: { ...node.prominence, cluster } };
  });

  const relations: PresentationRelation[] = [...graph.relations, ...withSpacing];
  for (const axis of axes) {
    const first = axis.members[0];
    if (first === undefined) continue;
    for (const member of axis.members.slice(1)) {
      relations.push({
        id: `aligns:${axis.id}:${first}:${member}`,
        kind: 'aligns',
        from: first,
        to: member,
        alignment: axis.kind,
      });
    }
  }
  for (const baseline of baselines) {
    const first = baseline.members[0]?.node;
    if (first === undefined) continue;
    for (const member of baseline.members.slice(1)) {
      relations.push({
        id: `baseline:${baseline.id}:${first}:${member.node}`,
        kind: 'shares-baseline',
        from: first,
        to: member.node,
      });
    }
  }
  const baselineByNode = new Map<string, number>();
  for (const baseline of baselines) {
    for (const member of baseline.members) {
      baselineByNode.set(member.node, baseline.coordinate + member.deviationPx);
    }
  }
  const axisByMember = new Map<string, AlignmentAxis[]>();
  for (const axis of axes) {
    for (const member of axis.members) {
      const current = axisByMember.get(member) ?? [];
      current.push(axis);
      axisByMember.set(member, current);
    }
  }

  return { nodes, relations, spacing, axes, baselines, prominence, surfaces, baselineByNode, axisByMember };
}

function siblingSeparations(graph: BuiltGraph): PresentationRelation[] {
  const raw: Array<PresentationRelation & { readonly distancePx: number }> = [];
  for (const parent of graph.nodes) {
    for (let index = 0; index < parent.children.length - 1; index += 1) {
      const left = graph.byId.get(parent.children[index]!);
      const right = graph.byId.get(parent.children[index + 1]!);
      if (left === undefined || right === undefined) continue;
      const gap = gapBetween(left.rect, right.rect);
      raw.push({
        id: `separates:${left.id}:${right.id}`,
        kind: 'separates',
        from: left.id,
        to: right.id,
        axis: gap.axis,
        distancePx: gap.distance,
      });
    }
  }
  const scale = median(raw.map((relation) => relation.distancePx).filter((distance) => distance > 0)) ?? 1;
  return raw.map((relation) => {
    const left = graph.byId.get(relation.from)!;
    const right = graph.byId.get(relation.to)!;
    const whitespace = relation.distancePx / (relation.distancePx + scale);
    const border = Math.min(1, Math.max(left.surface.borderWidthPx, right.surface.borderWidthPx) / 2);
    const surface = surfaceDistance(left, right) / 100;
    const shadow = left.surface.shadow || right.surface.shadow ? 1 : 0;
    const indent = Math.min(1, Math.abs(left.rect.x - right.rect.x) / Math.max(1, scale * 2));
    return {
      ...relation,
      boundaryStrength: round(
        Math.min(1, whitespace * 0.5 + border * 0.2 + surface * 0.15 + shadow * 0.1 + indent * 0.05),
      ),
    };
  });
}

function surfaceDistance(left: PresentationNode, right: PresentationNode): number {
  if (left.surface.fill === undefined || right.surface.fill === undefined) return 0;
  if (left.surface.fill === right.surface.fill) return 0;
  return Math.min(100, Math.max(left.surface.perceptualDifference ?? 0, right.surface.perceptualDifference ?? 0));
}

function alignmentAxes(nodes: readonly PresentationNode[]): AlignmentAxis[] {
  const definitions = [
    ['left', (node: PresentationNode) => node.rect.x],
    ['right', (node: PresentationNode) => node.rect.x + node.rect.width],
    ['horizontal-center', (node: PresentationNode) => node.rect.x + node.rect.width / 2],
    ['top', (node: PresentationNode) => node.rect.y],
    ['bottom', (node: PresentationNode) => node.rect.y + node.rect.height],
    ['vertical-center', (node: PresentationNode) => node.rect.y + node.rect.height / 2],
  ] as const;
  const axes: AlignmentAxis[] = [];
  for (const [kind, coordinateOf] of definitions) {
    const clusters = numericMembershipClusters(
      nodes.map((node) => ({ id: node.id, value: coordinateOf(node) })),
      1,
    ).filter((cluster) => cluster.members.length >= 2);
    clusters.forEach((cluster, index) => {
      axes.push({
        id: `A:${kind}:${index + 1}`,
        kind,
        coordinate: round(cluster.center, 2),
        members: cluster.members.map((member) => member.id).sort(),
      });
    });
  }
  return axes;
}

function baselineClusters(nodes: readonly PresentationNode[]): BaselineCluster[] {
  const candidates = nodes.flatMap((node) => {
    const size = node.typography.sizePx;
    const lineHeight = node.typography.lineHeightPx;
    if ((node.text === undefined && node.name === undefined) || size === undefined || lineHeight === undefined) return [];
    const coordinate = node.rect.y + Math.max(0, (node.rect.height - lineHeight) / 2) + size * 0.8;
    return [{ id: node.id, value: coordinate }];
  });
  return numericMembershipClusters(candidates, 1)
    .filter((cluster) => cluster.members.length >= 2)
    .map((cluster, index) => ({
      id: `B${index + 1}`,
      coordinate: round(cluster.center, 2),
      confidence: 'inferred' as const,
      members: cluster.members
        .map((member) => ({ node: member.id, deviationPx: round(member.value - cluster.center, 2) }))
        .sort((a, b) => codeUnitCompare(a.node, b.node)),
    }));
}

function prominenceClusters(nodes: readonly PresentationNode[]): ProminenceCluster[] {
  return numericMembershipClusters(
    nodes.map((node) => ({ id: node.id, value: node.prominence.magnitude })),
    0.12,
  ).map((cluster, index) => {
    const members = cluster.members.map((member) => member.id).sort();
    const semanticClasses = [...new Set(members.map((id) => nodes.find((node) => node.id === id)!.semanticClass))].sort();
    return {
      id: `P${index + 1}`,
      magnitude: round(cluster.center),
      members,
      semanticClasses,
    };
  });
}

function surfaceGroups(nodes: readonly PresentationNode[]): SurfaceGroup[] {
  const groups = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.surface.fill === undefined) continue;
    const members = groups.get(node.surface.fill) ?? [];
    members.push(node.id);
    groups.set(node.surface.fill, members);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([fill, members], index) => ({ id: `F${index + 1}`, fill, members: members.sort() }));
}

interface NumericCluster {
  readonly id: string;
  readonly center: number;
  readonly values: readonly number[];
}

function numericClusters(
  values: readonly number[],
  prefix: string,
  tolerance: (center: number) => number,
): NumericCluster[] {
  const clusters: number[][] = [];
  for (const value of [...values].sort((a, b) => a - b)) {
    const current = clusters.at(-1);
    const center = current === undefined ? undefined : median(current);
    if (current === undefined || center === undefined || Math.abs(value - center) > tolerance(center)) {
      clusters.push([value]);
    } else {
      current.push(value);
    }
  }
  return clusters.map((cluster, index) => ({
    id: `${prefix}${index + 1}`,
    center: median(cluster)!,
    values: cluster,
  }));
}

function numericMembershipClusters(
  values: readonly { readonly id: string; readonly value: number }[],
  tolerance: number,
): readonly {
  readonly center: number;
  readonly members: readonly { readonly id: string; readonly value: number }[];
}[] {
  const clusters: Array<Array<{ readonly id: string; readonly value: number }>> = [];
  for (const value of [...values].sort((a, b) => a.value - b.value || codeUnitCompare(a.id, b.id))) {
    const current = clusters.at(-1);
    const center = current === undefined ? undefined : median(current.map((member) => member.value));
    if (current === undefined || center === undefined || Math.abs(value.value - center) > tolerance) {
      clusters.push([value]);
    } else {
      current.push(value);
    }
  }
  return clusters.map((cluster) => ({ center: median(cluster.map((member) => member.value))!, members: cluster }));
}
