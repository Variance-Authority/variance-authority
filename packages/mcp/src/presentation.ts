import type {
  PresentationEffectEvidence,
  PresentationEffectRecord,
  PresentationSignalRecord,
  RunReport,
} from '@variance-authority/report';

/** Presentation consequence in the shared text vocabulary used by CLI and MCP. */
export function presentationSummary(report: RunReport): readonly string[] {
  const observed = report.observations.filter((entry) => entry.signals?.presentation !== undefined);
  if (observed.length === 0) return [];
  const comparable = observed.filter((entry) => entry.signals!.presentation!.verdict !== 'incomparable');
  const incomparable = observed.length - comparable.length;
  const effects = comparable.flatMap((entry) => {
    const signal = entry.signals!.presentation!;
    return signal.verdict === 'incomparable' ? [] : signal.effects;
  });
  const counts = new Map<string, number>();
  for (const effect of effects) counts.set(effect.transition, (counts.get(effect.transition) ?? 0) + 1);
  const changed = comparable.filter((entry) => entry.signals!.presentation!.verdict === 'changed').length;

  return [
    `presentation impact: ${counts.get('introduced') ?? 0} introduced, ` +
      `${counts.get('resolved') ?? 0} resolved, ${counts.get('persisted') ?? 0} persisted ` +
      `across ${changed} changed subject(s); ${comparable.length} compared, ${incomparable} incomparable. ` +
      'Independent of the regression verdict.',
  ];
}

/** One subject's durable presentation consequence, without re-running analysis. */
export function describePresentation(signal: PresentationSignalRecord): readonly string[] {
  if (signal.verdict === 'incomparable') {
    return [`presentation: incomparable — ${signal.because}`];
  }
  const information = signal.information;
  const info = [
    information.contentPreserved ? 'content preserved' : 'content changed',
    delta('characters', information.characters.delta),
    delta('elements', information.elements.delta),
    delta('repeated objects', information.repeatedObjects.delta),
  ].filter((part) => part !== '');
  if (signal.effects.length === 0) {
    return [`presentation: ${signal.verdict} — ${info.join(', ')}`];
  }
  return [
    `presentation: ${signal.verdict} — ${info.join(', ')}`,
    ...signal.effects.flatMap(effectLines),
  ];
}

function effectLines(effect: PresentationEffectRecord): readonly string[] {
  const identity =
    `  [${effect.transition}] ${effect.rule} at ${effect.owner}` +
    (effect.contract === undefined ? '' : ` (contract ${effect.contract})`);
  if (effect.transition === 'introduced') return [identity, evidenceLine('after', effect.after!)];
  if (effect.transition === 'resolved') return [identity, evidenceLine('before', effect.before!)];
  return [identity, evidenceLine('before', effect.before!), evidenceLine('after', effect.after!)];
}

function evidenceLine(side: string, evidence: PresentationEffectEvidence): string {
  const measurements = Object.entries(evidence.measurements)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
    .map(([name, value]) => `${name}=${value}`)
    .join(', ');
  return `    ${side} ${evidence.finding}${measurements === '' ? '' : `: ${measurements}`}`;
}

function delta(name: string, value: number): string {
  if (value === 0) return '';
  return `${name} ${value > 0 ? '+' : ''}${value}`;
}
