import { digestValue } from '@variance-authority/core/format';
import type {
  PresentationEffectEvidence,
  PresentationEffectRecord,
  PresentationInformationRecord,
  PresentationSignalRecord,
} from '@variance-authority/report';
import { comparePresentation } from './compare.js';
import { codeUnitCompare } from './math.js';
import type {
  PresentationFinding,
  PresentationHierarchyReading,
  PresentationReport,
} from './model.js';

export interface PresentationSignalOptions {
  /** Product-owned hierarchy readings evaluated against the before report. */
  readonly beforeHierarchy?: readonly PresentationHierarchyReading[];
  /** Product-owned hierarchy readings evaluated against the after report. */
  readonly afterHierarchy?: readonly PresentationHierarchyReading[];
}

/**
 * Project presentation evidence into the durable regression-report signal.
 *
 * Missing reports or layout findings are incomparable, never clean. The result
 * records consequences without changing the regression verdict or prescribing
 * a design response.
 */
export function presentationSignal(
  before: PresentationReport | undefined,
  after: PresentationReport | undefined,
  options: PresentationSignalOptions = {},
): PresentationSignalRecord {
  if (before === undefined || after === undefined) {
    return {
      verdict: 'incomparable',
      because:
        before === undefined && after === undefined
          ? 'neither side supplied a presentation reading'
          : `${before === undefined ? 'the baseline' : 'the candidate'} supplied no presentation reading`,
      ...(before === undefined ? {} : { before: before.digest }),
      ...(after === undefined ? {} : { after: after.digest }),
    };
  }

  const beforeFindings = findingsOf(before, options.beforeHierarchy ?? []);
  const afterFindings = findingsOf(after, options.afterHierarchy ?? []);
  if (beforeFindings === undefined || afterFindings === undefined) {
    return {
      verdict: 'incomparable',
      because:
        beforeFindings === undefined && afterFindings === undefined
          ? 'neither presentation reading contained layout findings'
          : `${beforeFindings === undefined ? 'the baseline' : 'the candidate'} contained no layout findings`,
      before: before.digest,
      after: after.digest,
    };
  }

  const comparison = comparePresentation(before, after);
  const information: PresentationInformationRecord = {
    contentPreserved: comparison.information.content.preserved,
    characters: difference(comparison.information.characters),
    elements: difference(comparison.information.elements),
    repeatedObjects: difference(comparison.information.repeatedObjects),
  };
  const effects = effectsOf(beforeFindings, afterFindings);
  const informationChanged =
    !information.contentPreserved ||
    information.characters.delta !== 0 ||
    information.elements.delta !== 0 ||
    information.repeatedObjects.delta !== 0;

  return {
    verdict: effects.length > 0 || informationChanged ? 'changed' : 'unchanged',
    before: before.digest,
    after: after.digest,
    information,
    effects,
  };
}

function findingsOf(
  report: PresentationReport,
  hierarchy: readonly PresentationHierarchyReading[],
): readonly PresentationFinding[] | undefined {
  for (const reading of hierarchy) {
    if (reading.report !== report.digest) {
      throw new Error(
        `presentation hierarchy ${reading.contract.id} reads ${reading.report}, not ${report.digest}`,
      );
    }
  }
  if (report.findings === undefined && hierarchy.length === 0) return undefined;
  return [...(report.findings ?? []), ...hierarchy.flatMap((reading) => reading.findings)];
}

function effectsOf(
  before: readonly PresentationFinding[],
  after: readonly PresentationFinding[],
): PresentationEffectRecord[] {
  const left = indexFindings(before, 'baseline');
  const right = indexFindings(after, 'candidate');
  const identities = [...new Set([...left.keys(), ...right.keys()])].sort(codeUnitCompare);

  const effects: PresentationEffectRecord[] = [];
  for (const identity of identities) {
    const previous = left.get(identity);
    const current = right.get(identity);
    const finding = current ?? previous!;
    const common = {
      rule: finding.rule,
      owner: finding.owner,
      nodes: [...finding.nodes].sort(codeUnitCompare),
      ...(finding.pattern === undefined ? {} : { pattern: finding.pattern }),
      ...(finding.contract === undefined ? {} : { contract: finding.contract }),
    };
    if (previous === undefined) {
      effects.push({ ...common, transition: 'introduced', after: evidence(current!) });
      continue;
    }
    if (current === undefined) {
      effects.push({ ...common, transition: 'resolved', before: evidence(previous) });
      continue;
    }
    if (digestValue(previous.measurements) === digestValue(current.measurements)) {
      continue;
    }
    effects.push({
      ...common,
      transition: 'persisted',
      before: evidence(previous),
      after: evidence(current),
    });
  }
  return effects;
}

function indexFindings(
  findings: readonly PresentationFinding[],
  side: 'baseline' | 'candidate',
): ReadonlyMap<string, PresentationFinding> {
  const result = new Map<string, PresentationFinding>();
  for (const finding of findings) {
    const identity = identityOf(finding);
    if (result.has(identity)) {
      throw new Error(`${side} presentation has duplicate finding identity ${identity}`);
    }
    result.set(identity, finding);
  }
  return result;
}

function identityOf(finding: PresentationFinding): string {
  return [
    finding.rule,
    finding.owner,
    finding.pattern ?? '',
    finding.contract ?? '',
    [...finding.nodes].sort(codeUnitCompare).join(','),
  ].join('\0');
}

function evidence(finding: PresentationFinding): PresentationEffectEvidence {
  return { finding: finding.id, measurements: finding.measurements };
}

function difference(value: { readonly before: number; readonly after: number }): {
  readonly before: number;
  readonly after: number;
  readonly delta: number;
} {
  return { ...value, delta: value.after - value.before };
}
