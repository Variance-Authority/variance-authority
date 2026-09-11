import type { Digest } from '@variance-authority/core/format';
import type { StateKey } from './state.js';

/**
 * What the detector concludes, and the words it says it in.
 *
 * A `Finding` is the entire product of a session — the standing world, the
 * probe, the ledger and the re-runs all exist to produce one. It lives apart
 * from the machinery that derives findings because the two change for different
 * reasons and at different rates: the wording of an accusation gets rewritten
 * every time an agent misreads one, while the derivation changes only when the
 * detection model does.
 *
 * Keeping the formatter in a module that cannot reach the runs is also a
 * standing guarantee. Text with no access to the ledger cannot quietly start
 * re-deriving a diagnosis instead of printing the one it was handed, so what a
 * report says is always exactly what the detector concluded.
 */

export interface Finding {
  /** `suspected` from read/write overlap; `confirmed` by a hash that moved. */
  readonly confidence: 'suspected' | 'confirmed';
  readonly victim: string;
  /** Absent when a hash moved but no earlier writer explains it. */
  readonly culprit?: string;
  readonly key?: StateKey;
  readonly evidence: string;
  /** What an agent should do about it. */
  readonly remedy: string;

  /**
   * Components the culprit subject rendered, innermost-first, deduplicated.
   *
   * A subject id names a *story*; a component name names the file to edit. An
   * agent handed "story:button polluted story:card" still has to find where the
   * stylesheet was injected — handed "…, rendered by Button ← Toolbar" it can go
   * straight there. Empty when no provenance provider was configured, which is
   * itself worth seeing: it means this session cannot attribute to code.
   */
  readonly culpritComponents?: readonly string[];
}

/**
 * Findings as text an agent can act on without re-deriving the diagnosis.
 *
 * Confirmed first: those are proven, and an agent working a list should not
 * spend its first move on a coupling that may never bite.
 */
export function formatFindings(findings: readonly Finding[]): string {
  if (findings.length === 0) return 'No cross-pollution detected.';

  const ordered = [...findings].sort((a, b) =>
    a.confidence === b.confidence ? 0 : a.confidence === 'confirmed' ? -1 : 1,
  );

  return ordered
    .map((finding) => {
      const where =
        finding.culpritComponents && finding.culpritComponents.length > 0
          ? ` (rendered by ${finding.culpritComponents.join(', ')})`
          : '';

      return [
        `[${finding.confidence}] ${finding.victim}`,
        `  cause:    ${finding.culprit ?? 'none — unstable on its own'}${where}`,
        finding.key ? `  via:      ${finding.key}` : null,
        `  evidence: ${finding.evidence}`,
        `  fix:      ${finding.remedy}`,
      ]
        .filter((line) => line !== null)
        .join('\n');
    })
    .join('\n\n');
}

/**
 * One coupling per victim/culprit/key, however many reads found it.
 *
 * A victim that matched four rules from the same polluted sheet was polluted
 * once, and reporting it four times would spend an agent's attention on the
 * arithmetic of the detector rather than on the leak.
 */
export function dedupe(findings: readonly Finding[]): Finding[] {
  const seen = new Set<string>();
  const unique: Finding[] = [];

  for (const finding of findings) {
    const signature = `${finding.victim}|${finding.culprit ?? ''}|${finding.key ?? ''}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    unique.push(finding);
  }

  return unique;
}

/** Enough digest to tell two hashes apart in prose, and no more. */
export function short(digest: Digest): string {
  return digest.slice(0, 11);
}
