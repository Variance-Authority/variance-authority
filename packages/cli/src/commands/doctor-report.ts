import { EXIT_CLEAN, EXIT_OPERATOR, type ExitCode } from '../exit.js';
import type { CachedIdentity, Diagnosis, FontFinding, Partition, RenderCacheFinding } from './doctor.js';

/**
 * A diagnosis as the two things a caller does with one: an integer, and a page.
 *
 * Split from `doctor.ts` at the size gate, along the seam that was already there
 * — everything on the other side of it *observes a machine*, and nothing here
 * touches one. The practical consequence is that the wording of the worst
 * finding this command has, and the exit code that goes with it, can be read and
 * changed without scrolling past a font probe.
 */

/**
 * Doctor's exit code.
 *
 * `2` for exactly one condition: no renderer. That is the state in which a run
 * cannot happen at all, which is what code `2` means.
 *
 * Missing fonts deliberately do *not* move it. See this file's header: the probe
 * cannot distinguish an absent family from a metric-compatible substitute, and a
 * diagnostic that fails a build on a false positive is a diagnostic somebody
 * deletes. They are printed at the top of the output instead, where a person
 * decides.
 */
export function exitForDiagnosis(diagnosis: Diagnosis): ExitCode {
  // Not-checked is not a failure. Exit 2 means *this machine cannot do the work*,
  // and a machine that was never asked has not answered that question either way.
  if (diagnosis.renderer.checked === false) return EXIT_CLEAN;
  if (!diagnosis.renderer.available) return EXIT_OPERATOR;

  /**
   * A store this machine cannot compare against is a machine that cannot do the
   * work, which is what exit 2 means (ADR-0017).
   *
   * The bar this has to clear is the one the font probe fails: a diagnostic that
   * fails CI on a false positive gets removed. It clears it, because this is not
   * a probe — the store's layout *is* the partition, so a run here would report
   * `incomparable` for every subject and produce no verdict at all. Exiting 0
   * would hand that runner a green doctor and a red morning.
   *
   * Only reachable when a renderer opened, the root exists, and it was scanned.
   * Every other state leaves `comparable` absent and lands above.
   */
  return diagnosis.baselines.comparable === false ? EXIT_OPERATOR : EXIT_CLEAN;
}

export function formatDiagnosis(diagnosis: Diagnosis): string {
  const identity = diagnosis.renderer.identity;

  return [
    `profile: ${diagnosis.profile}`,
    '',
    `renderer: ${
      diagnosis.renderer.checked === false
        ? 'not checked'
        : diagnosis.renderer.available
          ? 'available'
          : 'NOT AVAILABLE'
    }`,
    `  ${diagnosis.renderer.because}`,
    ...(identity !== undefined
      ? [
          `  identity: ${identity.renderer} (${identity.engine}, ${identity.platform}, ` +
            `${identity.deviceScaleFactor}x)`,
          `  fonts asserted into the identity: ${
            identity.fonts.length === 0 ? 'none' : identity.fonts.join(', ')
          }`,
        ]
      : []),
    '',
    `fonts: ${fontHeadline(diagnosis.fonts)}`,
    `  ${diagnosis.fonts.because}`,
    ...(diagnosis.fonts.probed
      ? [
          '  known limit: a family that is metric-compatible with a generic — Arimo, ' +
            'Liberation Sans, the substitutes a container ships so layout does not move —',
          '  is reported missing by this probe. It reports a doubt rather than swallowing ' +
            'one, and does not change the exit code.',
        ]
      : []),
    '',
    `baselines: ${diagnosis.baselines.kind}${
      diagnosis.baselines.comparable === false ? ' — NOT COMPARABLE HERE' : ''
    }`,
    `  ${diagnosis.baselines.because}`,
    ...partitionLines(diagnosis.baselines.partitions ?? []),
    '',
    `renders: ${mib(diagnosis.renders.bytes)} in ${diagnosis.renders.entries} entries`,
    `  ${diagnosis.renders.root}`,
    `  ${diagnosis.renders.because}`,
    ...cacheLines(diagnosis.renders),
    '',
    `history: ${diagnosis.history.configured ? 'configured' : 'none'}`,
    `  ${diagnosis.history.because}`,
  ].join('\n');
}

/**
 * The store, one line per machine that has written to it.
 *
 * Printed even when the answer is good, because the number that matters is not
 * "can I compare" but "against how much" — a store holding four baselines under
 * this identity and nine hundred under another is a suite that was resharded and
 * nobody noticed, and it reads as fine until it is laid out like this.
 */
function partitionLines(partitions: readonly Partition[]): readonly string[] {
  if (partitions.length === 0) return [];
  return [
    '  stored by identity:',
    ...partitions.map(
      (entry) =>
        `    ${entry.mine ? '→' : ' '} ${entry.identity.slice(0, 16)}… ` +
        `${entry.baselines} baseline(s)${entry.mine ? '  (this machine)' : ''}`,
    ),
  ];
}

/**
 * The cache, one line per identity, largest first.
 *
 * The split is the half a total cannot say. An operator who deleted a browser
 * version six months ago has a directory holding renders under an identity
 * nothing will ever hit again, and from a single number that is indistinguishable
 * from a cache that is working — it is the *second* line, the one with no arrow
 * beside a large size, that answers what is actually on the disk.
 */
function cacheLines(finding: RenderCacheFinding): readonly string[] {
  if (finding.identities.length === 0) return [];
  return [
    '  cached by identity:',
    ...finding.identities.map(
      (held: CachedIdentity) =>
        `    ${held.mine ? '→' : ' '} ${held.identity.slice(0, 16)}… ` +
        `${held.entries} entr${held.entries === 1 ? 'y' : 'ies'}, ${mib(held.bytes)}` +
        `${held.mine ? '  (this machine)' : ''}`,
    ),
  ];
}

function mib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

function fontHeadline(finding: FontFinding): string {
  if (!finding.probed) return 'not probed';
  return finding.missing.length === 0
    ? `${finding.asserted.length} asserted, none reported missing`
    : `${finding.missing.length} of ${finding.asserted.length} reported missing`;
}
