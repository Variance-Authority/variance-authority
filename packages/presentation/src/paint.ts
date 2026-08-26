import type {
  AlignmentAxis,
  BaselineCluster,
  PaintInstruction,
  PresentationFinding,
  PresentationNode,
  PresentationRelation,
  ProminenceCluster,
  RepeatedPattern,
  SurfaceGroup,
} from './model.js';
import { center } from './graph.js';

const COLORS = ['#00d4ff', '#ff2bd6', '#ffe600', '#70ff70', '#ff6b35', '#a78bfa'];

export function paintInstructions(input: {
  readonly nodes: readonly PresentationNode[];
  readonly relations: readonly PresentationRelation[];
  readonly axes: readonly AlignmentAxis[];
  readonly baselines: readonly BaselineCluster[];
  readonly prominence: readonly ProminenceCluster[];
  readonly surfaces: readonly SurfaceGroup[];
  readonly patterns: readonly RepeatedPattern[];
  readonly findings: readonly PresentationFinding[];
}): PaintInstruction[] {
  const byId = new Map(input.nodes.map((node) => [node.id, node]));
  const instructions: PaintInstruction[] = [];
  for (const node of input.nodes) {
    instructions.push({
      id: `semantic:${node.id}`,
      layer: 'semantic',
      shape: 'rect',
      color: COLORS[0]!,
      label: `${node.semanticClass} ${node.name ?? node.text ?? ''}`.trim(),
      rect: node.rect,
    });
  }
  for (const relation of input.relations.filter((candidate) => candidate.kind === 'separates')) {
    const from = byId.get(relation.from);
    const to = byId.get(relation.to);
    if (from === undefined || to === undefined) continue;
    const [x1, y1] = center(from.rect);
    const [x2, y2] = center(to.rect);
    instructions.push({
      id: `spacing:${relation.id}`,
      layer: 'spacing',
      shape: 'line',
      color: COLORS[2]!,
      label: `${relation.spacingCluster ?? 'gap'} ${relation.distancePx ?? 0}px`,
      line: { x1, y1, x2, y2 },
    });
  }
  for (const axis of input.axes) {
    const members = axis.members.flatMap((id) => byId.get(id) ?? []);
    if (members.length === 0) continue;
    const vertical = ['left', 'right', 'horizontal-center'].includes(axis.kind);
    instructions.push({
      id: `axis:${axis.id}`,
      layer: 'axes',
      shape: 'line',
      color: COLORS[3]!,
      label: `${axis.id} ${axis.coordinate}px`,
      line: vertical
        ? {
            x1: axis.coordinate,
            y1: Math.min(...members.map((node) => node.rect.y)),
            x2: axis.coordinate,
            y2: Math.max(...members.map((node) => node.rect.y + node.rect.height)),
          }
        : {
            x1: Math.min(...members.map((node) => node.rect.x)),
            y1: axis.coordinate,
            x2: Math.max(...members.map((node) => node.rect.x + node.rect.width)),
            y2: axis.coordinate,
          },
    });
  }
  for (const baseline of input.baselines) {
    const members = baseline.members.flatMap((member) => byId.get(member.node) ?? []);
    if (members.length === 0) continue;
    instructions.push({
      id: `baseline:${baseline.id}`,
      layer: 'baselines',
      shape: 'line',
      color: COLORS[4]!,
      label: `${baseline.id} inferred`,
      line: {
        x1: Math.min(...members.map((node) => node.rect.x)),
        y1: baseline.coordinate,
        x2: Math.max(...members.map((node) => node.rect.x + node.rect.width)),
        y2: baseline.coordinate,
      },
    });
  }
  groupedRects(input.surfaces, 'surfaces', input.nodes, instructions);
  groupedRects(input.prominence, 'prominence', input.nodes, instructions);
  input.patterns.forEach((pattern, index) => {
    for (const id of pattern.instances) {
      const node = byId.get(id);
      if (node === undefined) continue;
      instructions.push({
        id: `pattern:${pattern.id}:${id}`,
        layer: 'repetition',
        shape: 'rect',
        color: COLORS[index % COLORS.length]!,
        label: `${pattern.id} #${pattern.instances.indexOf(id) + 1}`,
        rect: node.rect,
      });
    }
  });
  for (const finding of input.findings) {
    for (const id of finding.nodes) {
      const node = byId.get(id);
      if (node === undefined) continue;
      instructions.push({
        id: `finding:${finding.rule}:${id}`,
        layer: 'findings',
        shape: 'rect',
        color: '#ff1744',
        label: finding.rule,
        rect: node.rect,
      });
    }
  }
  return instructions;
}

function groupedRects(
  groups: readonly { readonly id: string; readonly members: readonly string[] }[],
  layer: 'surfaces' | 'prominence',
  nodes: readonly PresentationNode[],
  sink: PaintInstruction[],
): void {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  groups.forEach((group, index) => {
    for (const member of group.members) {
      const node = byId.get(member);
      if (node === undefined) continue;
      sink.push({
        id: `${layer}:${group.id}:${member}`,
        layer,
        shape: 'rect',
        color: COLORS[index % COLORS.length]!,
        label: group.id,
        rect: node.rect,
      });
    }
  });
}
