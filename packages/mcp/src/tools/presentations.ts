import type { PresentationReport } from '@variance-authority/presentation';
import { stringArg, type Tool } from './tool.js';

export type PresentationEvidence = readonly PresentationReport[];

/** Full, process-owned presentation graphs supplied explicitly to the connection. */
export const presentations: Tool<PresentationEvidence> = {
  name: 'variance_presentations',
  description:
    'List supplied presentation readings, or describe one graph, its telemetry, semantic evidence, measured structures, and findings without reacquiring the page.',
  inputSchema: {
    type: 'object',
    properties: {
      subject: { type: 'string', description: 'A subject id, exact title, or unambiguous title part.' },
    },
    additionalProperties: false,
  },
  run(reports, input) {
    if (input['subject'] === undefined) return listing(reports);
    const found = locate(reports, stringArg(input, 'subject'));
    if (typeof found === 'string') return found;
    return describe(found);
  },
};

function listing(reports: PresentationEvidence): string {
  if (reports.length === 0) return 'Presentation measured a supplied collection containing no readings.';
  return [
    `${reports.length} presentation reading(s):`,
    ...reports.map((report) =>
      `  ${report.subject.title ?? report.subject.id} [${report.subject.id}] — ` +
      `${report.graph.nodes.length} node(s), ${report.graph.relations.length} relation(s)`),
  ].join('\n');
}

function locate(reports: PresentationEvidence, asked: string): PresentationReport | string {
  const byId = reports.find((report) => report.subject.id === asked);
  if (byId !== undefined) return byId;
  const exact = reports.filter((report) => report.subject.title === asked);
  if (exact.length === 1) return exact[0]!;
  const lowered = asked.toLowerCase();
  const partial = reports.filter((report) =>
    report.subject.title?.toLowerCase().includes(lowered) === true);
  if (partial.length === 1) return partial[0]!;
  if (partial.length === 0) return `No presentation subject matches ${asked}.`;
  return `${partial.length} presentation subjects match ${asked}; ask by id:\n${partial.map((report) =>
    `  ${report.subject.title ?? report.subject.id} [${report.subject.id}]`).join('\n')}`;
}

function describe(report: PresentationReport): string {
  const content = report.telemetry.content;
  const findings = report.findings;
  return [
    `${report.subject.title ?? report.subject.id} [${report.subject.id}]`,
    `Presentation ${report.digest}; content ${report.contentDigest}.`,
    `Graph: ${report.graph.nodes.length} node(s), ${report.graph.relations.length} relation(s).`,
    `Content: ${content.elements} element(s), ${content.characters} character(s), ` +
      `${content.controls} control(s), ${content.repeatedObjects} repeated object(s).`,
    report.semantic.browserAccessibility === undefined
      ? 'Browser accessibility: unavailable.'
      : `Browser accessibility: ${report.semantic.browserAccessibility.roots.length} root(s).`,
    measured('spacing clusters', report.spacing),
    measured('alignment axes', report.axes),
    measured('baseline clusters', report.baselines),
    measured('prominence clusters', report.prominence),
    measured('surface groups', report.surfaces),
    measured('repeated patterns', report.patterns),
    findings === undefined
      ? 'Findings: unavailable because this reading has no layout evidence.'
      : findings.length === 0
        ? 'Findings: measured empty.'
        : `Findings: ${findings.length}.\n${findings.map((finding) =>
          `  ${finding.rule} — owner ${finding.owner} — ${finding.nodes.join(', ')}`).join('\n')}`,
  ].join('\n');
}

function measured(name: string, values: readonly unknown[] | undefined): string {
  return values === undefined ? `${name}: unavailable.` : `${name}: measured ${values.length}.`;
}
