import type { BuiltGraph } from './graph.js';
import type { Measurements } from './measure.js';
import type {
  PresentationNode,
  PresentationRelation,
  PresentationSignature,
  RepeatedPattern,
} from './model.js';
import { codeUnitCompare, median, round } from './math.js';

export interface PatternResult {
  readonly patterns: RepeatedPattern[];
  readonly peerRelations: PresentationRelation[];
}

export function inferPatterns(graph: BuiltGraph, measured: Measurements): PatternResult {
  const patterns: RepeatedPattern[] = [];
  const peerRelations: PresentationRelation[] = [];
  const surfaceByNode = new Map<string, string>();
  for (const group of measured.surfaces) for (const member of group.members) surfaceByNode.set(member, group.id);

  for (const parent of measured.nodes) {
    const groups = new Map<string, PresentationNode[]>();
    for (const childId of parent.children) {
      const child = measured.nodes.find((candidate) => candidate.id === childId);
      if (child === undefined) continue;
      const shape = semanticShape(child, graph);
      const members = groups.get(shape) ?? [];
      members.push(child);
      groups.set(shape, members);
    }
    for (const [shape, instances] of [...groups.entries()].sort(([a], [b]) => codeUnitCompare(a, b))) {
      if (instances.length < 2) continue;
      const id = `R${patterns.length + 1}`;
      const signatures = instances.map((node) => signatureOf(node, measured, surfaceByNode));
      const dominant = dominantSignature(signatures);
      const deviations = signatures.map((signature) => signatureDeviation(signature, dominant));
      const stateMode = mode(instances.map((node) => node.stateSignature));
      const dominantInstances = instances
        .filter((_node, index) => deviations[index]! <= 0.3)
        .map((node) => node.id);
      const outliers = instances.flatMap((node, index) => {
        const deviation = deviations[index]!;
        return deviation <= 0.3
          ? []
          : [{
              node: node.id,
              deviation: round(deviation),
              explainedByState: node.stateSignature !== stateMode && node.stateSignature.length > 0,
            }];
      });
      const similarity = Math.max(0, 1 - (median(deviations) ?? 0));
      patterns.push({
        id,
        parent: parent.id,
        semanticShape: shape,
        instances: instances.map((node) => node.id),
        recurringLabels: recurringLabels(instances, graph),
        presentationSimilarity: round(similarity),
        dominant,
        dominantInstances,
        outliers,
      });
      for (let index = 0; index < instances.length - 1; index += 1) {
        const from = instances[index]!.id;
        const to = instances[index + 1]!.id;
        peerRelations.push({ id: `peer:${id}:${from}:${to}`, kind: 'semantic-peer', from, to });
      }
    }
  }
  return { patterns, peerRelations };
}

function semanticShape(node: PresentationNode, graph: BuiltGraph): string {
  const children = node.children
    .map((id) => graph.byId.get(id)?.semanticClass)
    .filter((value): value is string => value !== undefined);
  return `${node.semanticClass}[${children.join(',')}]`;
}

function signatureOf(
  node: PresentationNode,
  measured: Measurements,
  surfaceByNode: ReadonlyMap<string, string>,
): PresentationSignature {
  const internal = measured.relations.filter(
    (relation) =>
      relation.kind === 'separates' &&
      node.children.includes(relation.from) &&
      node.children.includes(relation.to),
  );
  const external = measured.relations.filter(
    (relation) =>
      relation.kind === 'separates' && (relation.from === node.id || relation.to === node.id),
  );
  const internalGapPx = median(internal.flatMap((relation) => relation.distancePx ?? []));
  const boundaryStrength = median(external.flatMap((relation) => relation.boundaryStrength ?? []));
  return {
    widthPx: node.rect.width,
    heightPx: node.rect.height,
    leftPx: node.rect.x,
    ...(internalGapPx === undefined ? {} : { internalGapPx: round(internalGapPx, 2) }),
    ...(boundaryStrength === undefined ? {} : { boundaryStrength: round(boundaryStrength) }),
    ...(node.prominence.cluster === undefined ? {} : { prominenceCluster: node.prominence.cluster }),
    ...(surfaceByNode.get(node.id) === undefined ? {} : { surfaceGroup: surfaceByNode.get(node.id)! }),
  };
}

function dominantSignature(signatures: readonly PresentationSignature[]): PresentationSignature {
  const numbers = (select: (signature: PresentationSignature) => number | undefined): number | undefined =>
    median(signatures.flatMap((signature) => select(signature) ?? []));
  const internalGapPx = numbers((signature) => signature.internalGapPx);
  const boundaryStrength = numbers((signature) => signature.boundaryStrength);
  const prominenceCluster = mode(signatures.map((signature) => signature.prominenceCluster ?? ''));
  const surfaceGroup = mode(signatures.map((signature) => signature.surfaceGroup ?? ''));
  return {
    widthPx: round(numbers((signature) => signature.widthPx) ?? 0, 2),
    heightPx: round(numbers((signature) => signature.heightPx) ?? 0, 2),
    leftPx: round(numbers((signature) => signature.leftPx) ?? 0, 2),
    ...(internalGapPx === undefined ? {} : { internalGapPx: round(internalGapPx, 2) }),
    ...(boundaryStrength === undefined ? {} : { boundaryStrength: round(boundaryStrength) }),
    ...(prominenceCluster.length === 0 ? {} : { prominenceCluster }),
    ...(surfaceGroup.length === 0 ? {} : { surfaceGroup }),
  };
}

function signatureDeviation(actual: PresentationSignature, dominant: PresentationSignature): number {
  const relative = (left: number, right: number, floor: number): number =>
    Math.abs(left - right) / Math.max(floor, Math.abs(right));
  const values = [
    relative(actual.widthPx, dominant.widthPx, 8),
    relative(actual.heightPx, dominant.heightPx, 16) * 0.35,
    Math.abs(actual.leftPx - dominant.leftPx) / 8,
  ];
  if (actual.internalGapPx !== undefined && dominant.internalGapPx !== undefined) {
    values.push(relative(actual.internalGapPx, dominant.internalGapPx, 4));
  }
  if (actual.prominenceCluster !== dominant.prominenceCluster) values.push(0.5);
  if (actual.surfaceGroup !== dominant.surfaceGroup) values.push(0.5);
  return Math.max(...values);
}

function recurringLabels(instances: readonly PresentationNode[], graph: BuiltGraph): string[] {
  const labelSets = instances.map((instance) => {
    const labels = descendants(instance, graph)
      .flatMap((node) => node.name ?? node.text ?? [])
      .map((label) => label.trim())
      .filter((label) => label.length > 0 && label.length <= 80);
    return new Set(labels);
  });
  const first = labelSets[0];
  if (first === undefined) return [];
  return [...first]
    .filter((label) => labelSets.every((labels) => labels.has(label)))
    .sort(codeUnitCompare);
}

export function descendants(node: PresentationNode, graph: BuiltGraph): PresentationNode[] {
  const result: PresentationNode[] = [];
  for (const id of node.children) {
    const child = graph.byId.get(id);
    if (child === undefined) continue;
    result.push(child, ...descendants(child, graph));
  }
  return result;
}

function mode(values: readonly string[]): string {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts.entries()].sort((left, right) => right[1] - left[1] || codeUnitCompare(left[0], right[0]))[0]?.[0] ?? '';
}
