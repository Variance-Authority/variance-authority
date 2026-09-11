import { digestValue } from '@variance-authority/core/format';
import type { PresentationComparison, PresentationFindingRule, PresentationReport } from './model.js';

/** Compare independent presentation dimensions without collapsing them into a score or verdict. */
export function comparePresentation(
  before: PresentationReport,
  after: PresentationReport,
): PresentationComparison {
  const beforeContent = contentIdentity(before);
  const afterContent = contentIdentity(after);
  const findings =
    before.findings === undefined || after.findings === undefined
      ? undefined
      : findingRules(before, after).map((rule) => {
          const left = before.findings!.filter((finding) => finding.rule === rule).length;
          const right = after.findings!.filter((finding) => finding.rule === rule).length;
          return { rule, before: left, after: right, delta: right - left };
        });
  return {
    formatVersion: 1,
    before: before.digest,
    after: after.digest,
    ...(findings === undefined ? {} : { findings }),
    information: {
      content: {
        before: beforeContent,
        after: afterContent,
        preserved: beforeContent === afterContent,
      },
      characters: {
        before: before.telemetry.content.characters,
        after: after.telemetry.content.characters,
      },
      elements: {
        before: before.telemetry.content.elements,
        after: after.telemetry.content.elements,
      },
      repeatedObjects: {
        before: before.telemetry.content.repeatedObjects,
        after: after.telemetry.content.repeatedObjects,
      },
    },
  };
}

function contentIdentity(report: PresentationReport): ReturnType<typeof digestValue> {
  return digestValue({
    content: report.contentDigest,
    browserAccessibility: report.semantic.browserAccessibility,
  } as never);
}

function findingRules(
  before: PresentationReport,
  after: PresentationReport,
): PresentationFindingRule[] {
  return [...new Set([...(before.findings ?? []), ...(after.findings ?? [])].map((finding) => finding.rule))]
    .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}
