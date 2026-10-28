import { digestFileName } from '@variance-authority/core/format';
import { EXIT_CLEAN, EXIT_OPERATOR, type ExitCode } from '../exit.js';
import type {
  BaselineFinding,
  CachedIdentity,
  Diagnosis,
  FontFinding,
  Partition,
  RenderCacheFinding,
} from './doctor.js';
import { formatCache } from './doctor-cache.js';
import { formatSkills } from './doctor-skills.js';
import { formatTypescript } from './doctor-typescript.js';

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
 * `2` for two conditions: no renderer, and an LFS store checked out as pointers.
 * Those are the states in which a run cannot do the work, which is what code `2`
 * means.
 *
 * Missing fonts deliberately do *not* move it. See this file's header: the probe
 * cannot distinguish an absent family from a metric-compatible substitute, and a
 * diagnostic that fails a build on a false positive is a diagnostic somebody
 * deletes. They are printed at the top of the output instead, where a person
 * decides.
 */
export function exitForDiagnosis(diagnosis: Diagnosis): ExitCode {
  // First, because the store is read from this disk whether or not a renderer
  // was asked: a remote renderer paints against the same pointers.
  if (exitForBaselines(diagnosis.baselines) === EXIT_OPERATOR) return EXIT_OPERATOR;

  // Not-checked is not a failure. Exit 2 means *this machine cannot do the work*,
  // and a machine that was never asked has not answered that question either way.
  if (diagnosis.renderer.checked === false) return EXIT_CLEAN;
  if (!diagnosis.renderer.available) return EXIT_OPERATOR;

  // A store another machine painted is a finding, not a refusal: the run
  // compares every subject and names the machine as the cause (ADR-0090).
  return EXIT_CLEAN;
}

/**
 * The store's part of the exit code, and all of `doctor --baselines`'s: `2` for
 * an LFS store checked out as pointers, which the run refuses with `2` at the
 * first subject that compares against one, and `0` for anything else.
 */
export function exitForBaselines(finding: BaselineFinding): ExitCode {
  return finding.pointers !== undefined ? EXIT_OPERATOR : EXIT_CLEAN;
}

/** The store's section of the page, and all of what `doctor --baselines` prints. */
export function formatBaselines(finding: BaselineFinding): string {
  return [
    `baselines: ${finding.kind}${
      finding.pointers !== undefined
        ? ' — POINTERS, NOT IMAGES'
        : finding.paintedHere === false
          ? ' — PAINTED ELSEWHERE'
          : ''
    }`,
    `  ${finding.because}`,
    ...partitionLines(finding.partitions ?? []),
  ].join('\n');
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
    // Only under a finding: the limit explains a missing family, and nothing else.
    ...(diagnosis.fonts.probed && diagnosis.fonts.missing.length > 0
      ? ['  exit code unaffected; a metric-compatible substitute (Arimo, Liberation Sans) also reads as missing']
      : []),
    '',
    formatBaselines(diagnosis.baselines),
    '',
    `renders: ${mib(diagnosis.renders.bytes)} in ${diagnosis.renders.entries} entries`,
    `  ${diagnosis.renders.root}`,
    `  ${diagnosis.renders.because}`,
    ...cacheLines(diagnosis.renders),
    '',
    ...formatCache(diagnosis.cache),
    '',
    `history: ${diagnosis.history.configured ? 'configured' : 'none'}`,
    `  ${diagnosis.history.because}`,
    '',
    ...formatSkills(diagnosis.skills),
    '',
    ...formatTypescript(diagnosis.typescript),
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
    ...partitions.flatMap((entry) => [
      `    ${entry.mine ? '→' : ' '} ${entry.identity.slice(0, 16)}… ` +
        `${entry.baselines} baseline(s)${entry.mine ? '  (this machine)' : ''}`,
      ...(entry.colonSpelled === undefined ? [] : [colonLine(entry.identity, entry.colonSpelled)]),
    ]),
  ];
}

/**
 * The partition still spelled with a colon, and the move that retires it.
 *
 * Said rather than fixed: those baselines compare, and the store moves each one
 * when it is next accepted, so nothing here is wrong on this machine. What the
 * name breaks is a checkout on Windows and an artifact upload, and a subject
 * whose pixels never change is never accepted again — so the move is handed to
 * the operator as a move, into a directory that cannot already hold the file.
 */
function colonLine(identity: string, count: number): string {
  return (
    `        ${count} of them in a \`${identity.slice(0, 16)}…\` directory, which Windows ` +
    `cannot check out; move its files into \`${digestFileName(identity).slice(0, 16)}…\` beside it`
  );
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
