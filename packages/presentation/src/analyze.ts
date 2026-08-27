import {
  digestValue,
  type AccessibilitySnapshot,
  type RawCapture,
  type RawNode,
} from '@variance-authority/core';
import { detectFindings } from './findings.js';
import { buildGraph } from './graph.js';
import { measureGraph } from './measure.js';
import type { PresentationReport } from './model.js';
import { paintInstructions } from './paint.js';
import { inferPatterns } from './patterns.js';
import { telemetryOf } from './telemetry.js';

export interface AnalyzePresentationOptions {
  /**
   * Browser-computed ARIA evidence observed beside this capture.
   *
   * Omit only when it was not observed. `roots: ['']` and partial roots are
   * readings and remain byte-for-byte present in the report.
   */
  readonly accessibility?: AccessibilitySnapshot;
}

/**
 * Derive machine-readable presentation relationships from one browser capture.
 *
 * Telemetry is descriptive and never creates a finding by itself. Findings are
 * limited to measured relationships; this function does not recommend a layout,
 * remove information, or produce an overall quality score.
 */
export function analyzePresentation(
  capture: RawCapture,
  options: AnalyzePresentationOptions = {},
): PresentationReport {
  const anchors = semanticAnchors(capture);
  const contentDigest = digestValue(contentEvidence(capture) as never);
  if (!capture.profile.layout) {
    const body = {
      formatVersion: 1 as const,
      contentDigest,
      subject: capture.subject,
      ...fontsOf(capture),
      semantic: {
        anchors,
        ...(options.accessibility === undefined ? {} : { browserAccessibility: options.accessibility }),
      },
      telemetry: telemetryOf(capture, [], undefined),
      graph: { nodes: [], relations: [] },
    };
    return { ...body, digest: digestValue(body as never) };
  }
  assertLayout(capture);
  const graph = buildGraph(capture);
  const measured = measureGraph(graph);
  const inferred = inferPatterns(graph, measured);
  const findings = detectFindings(graph, measured, inferred.patterns);
  const relations = [...measured.relations, ...inferred.peerRelations];
  const paint = paintInstructions({
    nodes: measured.nodes,
    relations,
    axes: measured.axes,
    baselines: measured.baselines,
    prominence: measured.prominence,
    surfaces: measured.surfaces,
    patterns: inferred.patterns,
    findings,
  });
  const body = {
    formatVersion: 1 as const,
    contentDigest,
    subject: capture.subject,
    ...fontsOf(capture),
    semantic: {
      anchors,
      ...(options.accessibility === undefined ? {} : { browserAccessibility: options.accessibility }),
    },
    telemetry: telemetryOf(capture, measured.nodes, inferred.patterns),
    graph: { nodes: measured.nodes, relations },
    spacing: measured.spacing,
    axes: measured.axes,
    baselines: measured.baselines,
    prominence: measured.prominence,
    surfaces: measured.surfaces,
    patterns: inferred.patterns,
    findings,
    paint,
  };
  return { ...body, digest: digestValue(body as never) };
}

/**
 * Carry the caller-established font identities onto the report.
 *
 * The live entry accepts a `fonts` option and threads it into the capture, and
 * the capture is then analyzed and dropped — so through that door the option
 * had no observable consequence at all. It has one here. Fonts are a render
 * input of the more consequential kind: a substitution moves every metric on
 * the page without changing a byte of code, so a reading taken under different
 * pinned identities is a different reading and the digest says so.
 *
 * Sorted, because the order a caller happened to list them in is not part of
 * their identity — the same position `normalize` takes on the environment key.
 * Absent rather than empty when none were established, matching the capture,
 * which says the same thing a second way with its `unverified-fonts` caveat.
 * The content digest is deliberately untouched: font identity is presentation,
 * and content identity is what has to survive presentation moving.
 */
function fontsOf(capture: RawCapture): { fonts?: readonly string[] } {
  const fonts = capture.environment.fonts;
  return fonts.length === 0 ? {} : { fonts: [...fonts].sort() };
}

function contentEvidence(capture: RawCapture): unknown {
  const read = (node: RawNode): unknown => ({
    tag: node.tag,
    ...(node.aria === undefined ? {} : { aria: node.aria }),
    ...(node.text === undefined ? {} : { text: node.text }),
    children: node.children.map(read),
    ...(node.shadowChildren === undefined ? {} : { shadowChildren: node.shadowChildren.map(read) }),
  });
  return {
    root: read(capture.root),
    ...(capture.portals === undefined ? {} : { portals: capture.portals.map(read) }),
  };
}

function semanticAnchors(capture: RawCapture): string[] {
  const anchors: string[] = [];
  [capture.root, ...(capture.portals ?? [])].forEach((root, rootIndex) => walk(root, rootIndex, '0'));
  return anchors;

  function walk(node: RawNode, root: number, path: string): void {
    if (
      node.tag !== '#text' &&
      node.aria !== undefined &&
      (node.aria.role !== null || node.aria.name !== null)
    ) {
      const role = node.aria?.role ?? node.tag;
      const name = node.aria?.name ?? '';
      anchors.push(`r${root}:${path} ${role}${name.length > 0 ? ` "${name}"` : ''}`);
    }
    node.children.forEach((child, index) => walk(child, root, `${path}/${index}`));
    node.shadowChildren?.forEach((child, index) => walk(child, root, `${path}/shadow:${index}`));
  }
}

function assertLayout(capture: RawCapture): void {
  [capture.root, ...(capture.portals ?? [])].forEach((root, rootIndex) => walk(root, `r${rootIndex}:0`));

  function walk(node: RawNode, path: string): void {
    if (node.tag !== '#text' && node.rect === undefined) {
      throw new Error(
        `the ${capture.profile.id} capture claims layout is observable but ${path} has no rect; ` +
          'an absent measurement cannot be analyzed as an empty box',
      );
    }
    node.children.forEach((child, index) => walk(child, `${path}/${index}`));
    node.shadowChildren?.forEach((child, index) => walk(child, `${path}/shadow:${index}`));
  }
}
