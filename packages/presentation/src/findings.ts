import type { BuiltGraph } from './graph.js';
import type { Measurements } from './measure.js';
import type {
  PresentationFinding,
  PresentationNode,
  RepeatedPattern,
} from './model.js';
import { codeUnitCompare, median, round } from './math.js';

type DetectedFinding = Omit<PresentationFinding, 'id'>;

/** Thresholds are pinned by the acceptance fixtures, never user-facing targets. */
const CALIBRATION = {
  relationshipRatio: 1.15,
  weakBoundary: 0.28,
  surfaceDelta: 8,
  axisDeviationPx: 2,
  baselineDeviationPx: 2,
} as const;

export function detectFindings(
  graph: BuiltGraph,
  measured: Measurements,
  patterns: readonly RepeatedPattern[],
): PresentationFinding[] {
  const findings: DetectedFinding[] = [];
  for (const pattern of patterns) {
    findings.push(...relationshipFindings(pattern, measured));
    findings.push(...hierarchySpacingFindings(pattern, measured));
    findings.push(...slotFindings(pattern, graph));
    const unexplained = pattern.outliers.filter((outlier) => !outlier.explainedByState);
    if (
      pattern.instances.length >= 3 &&
      pattern.dominantInstances.length * 2 >= pattern.instances.length &&
      unexplained.length > 0
    ) {
      findings.push({
        rule: 'PRESENTATION_GRAMMAR_DRIFT',
        owner: pattern.parent,
        nodes: unexplained.map((outlier) => outlier.node),
        pattern: pattern.id,
        measurements: {
          dominantInstances: pattern.dominantInstances.length,
          peerInstances: pattern.instances.length,
          maxDeviation: round(Math.max(...unexplained.map((outlier) => outlier.deviation))),
        },
      });
    }
  }
  findings.push(...surfaceFindings(measured.nodes));
  findings.push(...prominenceFindings(measured));
  return findings.sort((left, right) =>
    codeUnitCompare(left.rule, right.rule) ||
    codeUnitCompare(left.owner, right.owner) ||
    codeUnitCompare(left.nodes.join('\0'), right.nodes.join('\0')) ||
    codeUnitCompare(left.pattern ?? '', right.pattern ?? ''),
  ).map((finding, index) => ({ id: `F${index + 1}`, ...finding }));
}

/** A leading structural label and the body peers it introduces need distinct spacing relations. */
function hierarchySpacingFindings(
  pattern: RepeatedPattern,
  measured: Measurements,
): DetectedFinding[] {
  const byId = new Map(measured.nodes.map((node) => [node.id, node]));
  const separations = new Map(measured.relations
    .filter((relation) => relation.kind === 'separates')
    .map((relation) => [`${relation.from}\0${relation.to}`, relation]));
  const collisions = pattern.instances.flatMap((instanceId) => {
    const instance = byId.get(instanceId);
    if (instance === undefined || instance.children.length < 3) return [];
    const leader = byId.get(instance.children[0]!);
    const body = instance.children.slice(1).map((id) => byId.get(id));
    if (leader === undefined || body.some((node) => node === undefined)) return [];
    const bodyNodes = body as PresentationNode[];
    if (
      bodyNodes.length < 2 ||
      bodyNodes.some((node) => node.semanticClass !== bodyNodes[0]!.semanticClass) ||
      leader.semanticClass === bodyNodes[0]!.semanticClass
    ) return [];
    const leading = separations.get(`${leader.id}\0${bodyNodes[0]!.id}`);
    const peer = bodyNodes.slice(0, -1).flatMap((node, index) =>
      separations.get(`${node.id}\0${bodyNodes[index + 1]!.id}`) ?? []);
    const leadingGap = leading?.distancePx;
    const peerGap = median(peer.flatMap((relation) => relation.distancePx ?? []));
    if (leadingGap === undefined || peerGap === undefined) return [];
    const leadingClusters = new Set(leading?.spacingCluster === undefined ? [] : [leading.spacingCluster]);
    const peerClusters = new Set(peer.flatMap((relation) => relation.spacingCluster ?? []));
    const sharedCluster = [...leadingClusters].some((cluster) => peerClusters.has(cluster));
    const smaller = Math.min(leadingGap, peerGap);
    const larger = Math.max(leadingGap, peerGap);
    const ratio = smaller === 0 ? (larger === 0 ? 1 : Number.POSITIVE_INFINITY) : larger / smaller;
    if (!sharedCluster && ratio > CALIBRATION.relationshipRatio) return [];
    return [{
      instance: instance.id,
      leader: leader.id,
      body: bodyNodes.map((node) => node.id),
      leadingGap,
      peerGap,
      ratio,
      sharedCluster,
    }];
  });
  if (collisions.length < 2) return [];
  return [{
    rule: 'SPACING_HIERARCHY_COLLISION',
    owner: pattern.parent,
    nodes: collisions.map((collision) => collision.instance),
    pattern: pattern.id,
    measurements: {
      instances: collisions.length,
      leadingToBodyGapMedianPx: round(median(collisions.map((collision) => collision.leadingGap))!, 2),
      bodyToBodyGapMedianPx: round(median(collisions.map((collision) => collision.peerGap))!, 2),
      ratio: round(median(collisions.map((collision) => collision.ratio))!),
      sharedSpacingClusterInstances: collisions.filter((collision) => collision.sharedCluster).length,
    },
  }];
}

function relationshipFindings(
  pattern: RepeatedPattern,
  measured: Measurements,
): DetectedFinding[] {
  const members = new Set(pattern.instances);
  const between = measured.relations.filter(
    (relation) => relation.kind === 'separates' && members.has(relation.from) && members.has(relation.to),
  );
  const within = pattern.instances.flatMap((instance) => {
    const node = measured.nodes.find((candidate) => candidate.id === instance);
    if (node === undefined) return [];
    const children = new Set(node.children);
    return measured.relations.filter(
      (relation) => relation.kind === 'separates' && children.has(relation.from) && children.has(relation.to),
    );
  });
  const betweenBoundary = median(between.flatMap((relation) => relation.boundaryStrength ?? []));
  const withinBoundary = median(within.flatMap((relation) => relation.boundaryStrength ?? []));
  const betweenGap = median(between.flatMap((relation) => relation.distancePx ?? []));
  const withinGap = median(within.flatMap((relation) => relation.distancePx ?? []));
  const results: DetectedFinding[] = [];
  if (betweenBoundary !== undefined && withinBoundary !== undefined) {
    const ratio = withinBoundary === 0 ? (betweenBoundary === 0 ? 1 : Number.POSITIVE_INFINITY) : betweenBoundary / withinBoundary;
    if (ratio <= CALIBRATION.relationshipRatio) {
      results.push({
        rule: 'SEPARATION_COLLISION',
        owner: pattern.parent,
        nodes: pattern.instances,
        pattern: pattern.id,
        measurements: {
          withinBoundaryMedian: round(withinBoundary),
          betweenBoundaryMedian: round(betweenBoundary),
          ratio: round(ratio),
        },
      });
    }
    if (pattern.instances.length >= 3 && betweenBoundary <= CALIBRATION.weakBoundary) {
      results.push({
        rule: 'REPETITION_GRAMMAR_COLLAPSE',
        owner: pattern.parent,
        nodes: pattern.instances,
        pattern: pattern.id,
        measurements: {
          instances: pattern.instances.length,
          betweenBoundaryMedian: round(betweenBoundary),
          presentationSimilarity: pattern.presentationSimilarity,
        },
      });
    }
  }
  if (betweenGap !== undefined && withinGap !== undefined) {
    const ratio = withinGap === 0 ? (betweenGap === 0 ? 1 : Number.POSITIVE_INFINITY) : betweenGap / withinGap;
    const betweenClusters = new Set(between.flatMap((relation) => relation.spacingCluster ?? []));
    const withinClusters = new Set(within.flatMap((relation) => relation.spacingCluster ?? []));
    const overlap = [...betweenClusters].some((cluster) => withinClusters.has(cluster));
    if (overlap || ratio <= CALIBRATION.relationshipRatio) {
      results.push({
        rule: 'SPACING_RELATION_COLLISION',
        owner: pattern.parent,
        nodes: pattern.instances,
        pattern: pattern.id,
        measurements: {
          withinGapMedianPx: round(withinGap, 2),
          betweenGapMedianPx: round(betweenGap, 2),
          ratio: round(ratio),
        },
      });
    }
  }
  return results;
}

function slotFindings(pattern: RepeatedPattern, graph: BuiltGraph): DetectedFinding[] {
  if (pattern.instances.length < 4) return [];
  const slots = new Map<string, Array<{ readonly node: PresentationNode; readonly instance: PresentationNode }>>();
  for (const instanceId of pattern.instances) {
    const instance = graph.byId.get(instanceId);
    if (instance === undefined) continue;
    const occurrence = new Map<string, number>();
    for (const childId of instance.children) {
      const child = graph.byId.get(childId);
      if (child === undefined) continue;
      const count = occurrence.get(child.semanticClass) ?? 0;
      occurrence.set(child.semanticClass, count + 1);
      const key = `${child.semanticClass}:${count}`;
      const members = slots.get(key) ?? [];
      members.push({ node: child, instance });
      slots.set(key, members);
    }
  }
  const findings: DetectedFinding[] = [];
  for (const [slot, members] of slots) {
    if (members.length !== pattern.instances.length) continue;
    const left = median(members.map((member) => member.node.rect.x))!;
    const aligned = members.filter((member) => Math.abs(member.node.rect.x - left) <= 1);
    const alignmentOutliers = members.filter(
      (member) => Math.abs(member.node.rect.x - left) > CALIBRATION.axisDeviationPx,
    );
    if (aligned.length * 3 >= members.length * 2 && alignmentOutliers.length > 0) {
      findings.push({
        rule: 'ALIGNMENT_OUTLIER',
        owner: pattern.parent,
        nodes: alignmentOutliers.map((member) => member.node.id),
        pattern: pattern.id,
        measurements: {
          slot,
          dominantLeftPx: round(left, 2),
          maxDeviationPx: round(Math.max(...alignmentOutliers.map((member) => Math.abs(member.node.rect.x - left))), 2),
        },
      });
    }

    const baselines = members.flatMap(({ node, instance }) => {
      const size = node.typography.sizePx;
      const lineHeight = node.typography.lineHeightPx;
      if (size === undefined || lineHeight === undefined || (node.text === undefined && node.name === undefined)) return [];
      return [{
        node,
        coordinate:
          node.rect.y - instance.rect.y + Math.max(0, (node.rect.height - lineHeight) / 2) + size * 0.8,
      }];
    });
    if (baselines.length !== members.length) continue;
    const baseline = median(baselines.map((candidate) => candidate.coordinate))!;
    const baselineAligned = baselines.filter((candidate) => Math.abs(candidate.coordinate - baseline) <= 1);
    const baselineOutliers = baselines.filter(
      (candidate) => Math.abs(candidate.coordinate - baseline) > CALIBRATION.baselineDeviationPx,
    );
    if (baselineAligned.length * 3 >= baselines.length * 2 && baselineOutliers.length > 0) {
      findings.push({
        rule: 'BASELINE_DRIFT',
        owner: pattern.parent,
        nodes: baselineOutliers.map((candidate) => candidate.node.id),
        pattern: pattern.id,
        measurements: {
          slot,
          dominantBaselinePx: round(baseline, 2),
          maxDeviationPx: round(Math.max(...baselineOutliers.map((candidate) => Math.abs(candidate.coordinate - baseline))), 2),
          confidence: 'inferred',
        },
      });
    }
  }
  return findings;
}

function surfaceFindings(nodes: readonly PresentationNode[]): DetectedFinding[] {
  const surfaceTags = new Set(['button', 'input', 'select', 'textarea', 'article', 'section', 'aside', 'dialog']);
  return nodes.flatMap((node) => {
    const difference = node.surface.perceptualDifference;
    const meaningful = node.role !== undefined || surfaceTags.has(node.tag);
    if (
      node.parent === undefined ||
      !meaningful ||
      node.surface.fill === undefined ||
      difference === undefined ||
      difference >= CALIBRATION.surfaceDelta ||
      node.surface.borderWidthPx > 0 ||
      node.surface.shadow
    ) return [];
    return [{
      rule: 'SURFACE_COLLISION' as const,
      owner: node.parent,
      nodes: [node.id],
      measurements: {
        perceptualDifference: difference,
        borderWidthPx: node.surface.borderWidthPx,
        shadow: node.surface.shadow ? 1 : 0,
      },
    }];
  });
}

function prominenceFindings(measured: Measurements): DetectedFinding[] {
  const byId = new Map(measured.nodes.map((node) => [node.id, node]));
  return measured.nodes.flatMap((owner) => measured.prominence.flatMap((cluster) => {
    const members = owner.children.flatMap((id) => {
      const node = byId.get(id);
      return node !== undefined && node.prominence.cluster === cluster.id ? [node] : [];
    });
    const headings = members.filter((node) => node.semanticClass.startsWith('heading'));
    const ordinary = members.filter((node) =>
      ['label', 'paragraph', 'text', 'generic', 'span'].includes(node.semanticClass),
    );
    if (headings.length === 0 || ordinary.length === 0) return [];
    return [{
      rule: 'PROMINENCE_COLLAPSE' as const,
      owner: owner.id,
      nodes: [...headings, ...ordinary].map((node) => node.id),
      measurements: {
        prominenceCluster: cluster.id,
        semanticClasses: [...new Set([...headings, ...ordinary].map((node) => node.semanticClass))].join(','),
        magnitude: cluster.magnitude,
      },
    }];
  }));
}
