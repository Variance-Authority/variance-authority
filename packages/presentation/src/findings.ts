import type { BuiltGraph } from './graph.js';
import type { Measurements } from './measure.js';
import type {
  PresentationFinding,
  PresentationNode,
  RepeatedPattern,
} from './model.js';
import { median, round } from './math.js';

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
  const findings: PresentationFinding[] = [];
  for (const pattern of patterns) {
    findings.push(...relationshipFindings(pattern, measured));
    findings.push(...slotFindings(pattern, graph));
    const unexplained = pattern.outliers.filter((outlier) => !outlier.explainedByState);
    if (
      pattern.instances.length >= 3 &&
      pattern.dominantInstances.length * 2 >= pattern.instances.length &&
      unexplained.length > 0
    ) {
      findings.push({
        rule: 'PRESENTATION_GRAMMAR_DRIFT',
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
    left.rule < right.rule ? -1 : left.rule > right.rule ? 1 : (left.nodes[0] ?? '') < (right.nodes[0] ?? '') ? -1 : 1,
  );
}

function relationshipFindings(
  pattern: RepeatedPattern,
  measured: Measurements,
): PresentationFinding[] {
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
  const results: PresentationFinding[] = [];
  if (betweenBoundary !== undefined && withinBoundary !== undefined) {
    const ratio = withinBoundary === 0 ? (betweenBoundary === 0 ? 1 : Number.POSITIVE_INFINITY) : betweenBoundary / withinBoundary;
    if (ratio <= CALIBRATION.relationshipRatio) {
      results.push({
        rule: 'SEPARATION_COLLISION',
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

function slotFindings(pattern: RepeatedPattern, graph: BuiltGraph): PresentationFinding[] {
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
  const findings: PresentationFinding[] = [];
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

function surfaceFindings(nodes: readonly PresentationNode[]): PresentationFinding[] {
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
      nodes: [node.id],
      measurements: {
        perceptualDifference: difference,
        borderWidthPx: node.surface.borderWidthPx,
        shadow: node.surface.shadow ? 1 : 0,
      },
    }];
  });
}

function prominenceFindings(measured: Measurements): PresentationFinding[] {
  return measured.prominence.flatMap((cluster) => {
    const headings = cluster.semanticClasses.filter((kind) => kind.startsWith('heading'));
    const ordinary = cluster.semanticClasses.filter((kind) =>
      ['label', 'paragraph', 'text', 'generic', 'span', 'div'].includes(kind),
    );
    if (headings.length === 0 || ordinary.length === 0) return [];
    const nodes = cluster.members.filter((id) => {
      const semanticClass = measured.nodes.find((node) => node.id === id)?.semanticClass ?? '';
      return headings.includes(semanticClass) || ordinary.includes(semanticClass);
    });
    return [{
      rule: 'PROMINENCE_COLLAPSE' as const,
      nodes,
      measurements: {
        prominenceCluster: cluster.id,
        semanticClasses: [...headings, ...ordinary].join(','),
        magnitude: cluster.magnitude,
      },
    }];
  });
}
