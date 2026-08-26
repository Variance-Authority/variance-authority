import type {
  PaintInstruction,
  PaintLayer,
  PresentationFocus,
  PresentationFocusDepth,
  PresentationNode,
  PresentationReport,
} from './model.js';

export interface FocusPresentationOptions {
  /** `owner` keeps nested boxes separate; `subtree` reads the composition holistically. */
  readonly depth?: PresentationFocusDepth;
  /** Omit to retain every paint layer owned by the selected structural depth. */
  readonly paint?: readonly PaintLayer[];
  /** Omit to read every owned finding; provide ids to isolate one or more questions. */
  readonly findings?: readonly string[];
}

/**
 * Read one structural level from an existing report without acquiring the page again.
 *
 * An owner focus contains only relationships owned by that node. Nested evidence is
 * counted but not folded into the result. A subtree focus deliberately includes it.
 */
export function focusPresentation(
  report: PresentationReport,
  ownerId: string,
  options: FocusPresentationOptions = {},
): PresentationFocus {
  const byId = new Map(report.graph.nodes.map((node) => [node.id, node]));
  const owner = byId.get(ownerId);
  if (owner === undefined) throw new Error(`presentation owner ${ownerId} is not in report ${report.digest}`);
  const depth = options.depth ?? 'owner';
  const descendants = descendantIds(owner, byId);
  const selectedOwners = depth === 'subtree' ? new Set([ownerId, ...descendants]) : new Set([ownerId]);
  const ownedFindings = (report.findings ?? []).filter((finding) => selectedOwners.has(finding.owner));
  const requestedFindings = options.findings === undefined ? undefined : new Set(options.findings);
  if (requestedFindings !== undefined) {
    for (const id of requestedFindings) {
      if (!ownedFindings.some((finding) => finding.id === id)) {
        throw new Error(`presentation finding ${id} is not owned by ${ownerId} at ${depth} depth`);
      }
    }
  }
  const findings = requestedFindings === undefined
    ? ownedFindings
    : ownedFindings.filter((finding) => requestedFindings.has(finding.id));
  const selectedPatterns = requestedFindings === undefined
    ? undefined
    : new Set(findings.flatMap((finding) => finding.pattern ?? []));
  const patterns = (report.patterns ?? []).filter(
    (pattern) => selectedOwners.has(pattern.parent) && (selectedPatterns?.has(pattern.id) ?? true),
  );
  const selectedNodeIds = depth === 'subtree'
    ? [ownerId, ...descendants]
    : [
        ownerId,
        ...owner.children,
        ...findings.flatMap((finding) => finding.nodes),
        ...patterns.flatMap((pattern) => pattern.instances),
      ];
  const selectedNodes = [...new Set(selectedNodeIds)].flatMap((id) => byId.get(id) ?? []);
  const layers = options.paint === undefined ? undefined : new Set(options.paint);
  const relevantNodes = new Set([
    ...findings.flatMap((finding) => finding.nodes),
    ...patterns.flatMap((pattern) => pattern.instances),
  ]);
  const paint = (report.paint ?? []).filter(
    (instruction) =>
      selectedOwners.has(instruction.owner) &&
      (layers?.has(instruction.layer) ?? true) &&
      (requestedFindings === undefined || selectedPaint(instruction, requestedFindings, selectedPatterns!, relevantNodes)),
  );
  const nestedOwners = new Set(descendants);
  const nestedPatterns = (report.patterns ?? []).filter((pattern) => nestedOwners.has(pattern.parent));
  const nestedFindings = (report.findings ?? []).filter((finding) => nestedOwners.has(finding.owner));
  return {
    formatVersion: 1,
    report: report.digest,
    depth,
    owner,
    nodes: selectedNodes,
    patterns,
    findings,
    paint,
    nested: {
      owners: new Set([...nestedPatterns.map((pattern) => pattern.parent), ...nestedFindings.map((finding) => finding.owner)]).size,
      patterns: nestedPatterns.length,
      findings: nestedFindings.length,
    },
  };
}

function selectedPaint(
  instruction: PaintInstruction,
  findings: ReadonlySet<string>,
  patterns: ReadonlySet<string>,
  nodes: ReadonlySet<string>,
): boolean {
  if (instruction.finding !== undefined) return findings.has(instruction.finding);
  if (instruction.pattern !== undefined) return patterns.has(instruction.pattern);
  return instruction.nodes.some((node) => nodes.has(node));
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
