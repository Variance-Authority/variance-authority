/**
 * `variance restrictions`: the imports, chains, layers and code sizes the
 * `.relations.json` rules forbid.
 *
 * The rule files are read by `relations-file.ts`, and the source index owns
 * the imports. A transitive rule is walked from the files packages ship, which
 * the code map lists, so a test that reaches outside is not a finding. The
 * exit is `1` when anything is restricted and `0` when nothing is, because a
 * fence that cannot fail is a comment; whoever does not want the gate does not
 * run it. A package whose known lines fit its budget while part of its closure
 * could not be sized is printed as undecided and does not fail the gate: the
 * rule cannot say it broke.
 */

// compass: variance-authority.reach.relations

import { join } from 'node:path';
import { isCI } from 'ci-info';
import {
  cappedLayers,
  cappedTiers,
  packageLayers,
  publishedSources,
  restrictedChains,
  restrictedImports,
  shippedFiles,
  type CapViolation,
  type ChainViolation,
  type RuleFile,
  type TierCapFinding,
  type TierCapReport,
  type Tiers,
  type Violation,
} from '@variance-authority/sense';
import { readTiers } from '../config-declared.js';
import { EXIT_CLEAN, EXIT_REVIEW, OperatorError, type ExitCode } from '../exit.js';
import type { ParsedRestrictions } from '../restrictions-args.js';
import { RULE_FILE, ruleFiles } from './relations-file.js';

export { RULE_FILE } from './relations-file.js';

type PackageLayers = NonNullable<NonNullable<ReturnType<typeof packageLayers>>['packages']>;

/** The code map's packages, read once and only when a ceiling needs them; a map that holds none is an error, not a pass. */
function mapped(root: string, what: string, needsCurrent: boolean): PackageLayers {
  const layers = packageLayers(root);
  if (layers?.packages == null) {
    throw new OperatorError(`A \`${what}\` is written, but the source index holds no package layers to check it against; \`variance index\` folds them.`);
  }
  if (needsCurrent && !layers.current) {
    throw new OperatorError(`A \`${what}\` is written, but the code map was folded from an older source index; \`variance index\` folds it again.`);
  }
  return layers.packages;
}

function cappedPackages(root: string, files: readonly RuleFile[]): CapViolation[] {
  if (!files.some((file) => (file.caps?.length ?? 0) > 0)) return [];
  return cappedLayers(mapped(root, 'maxLayer', false), files);
}

function budgeted(root: string, files: readonly RuleFile[], tiers: Tiers | undefined): TierCapReport {
  if (tiers === undefined || !files.some((file) => (file.tierCaps?.length ?? 0) > 0)) return { violated: [], undecided: [] };
  return cappedTiers(mapped(root, 'maxTier', true), files, tiers);
}

/** The shipped files a transitive rule is walked from, read only when one is written. */
function seeds(root: string, files: readonly RuleFile[]): readonly string[] {
  if (!files.some((file) => file.rules.some((rule) => rule.transitive === true))) return [];
  const shipped = shippedFiles(root);
  if (shipped === undefined) {
    throw new OperatorError('A transitive rule is written, but no code map is kept beside the source index to say which files packages ship; `variance index` folds one.');
  }
  if (!shipped.current) {
    throw new OperatorError('A transitive rule is written, but the code map was folded from an older source index; `variance index` folds it again.');
  }
  return shipped.files;
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? '' : 's'}`;
}

function because(message: string | undefined, directory: string): string {
  return `${message === undefined ? '' : `: ${message}`} (${join(directory, RULE_FILE)})`;
}

interface Found {
  readonly imports: readonly Violation[];
  readonly chains: readonly ChainViolation[];
  readonly capped: readonly CapViolation[];
  readonly tiers: TierCapReport;
}

function budgetLine(v: TierCapFinding, verdict: string): string {
  const unsized = v.unsizedFiles > 0 ? ` and ${plural(v.unsizedFiles, 'file')} it could not size` : '';
  return `${v.package} pulls in ${v.lines} lines${unsized}, ${verdict} the ${v.budget} of tier ${v.maxTier}${because(v.message, v.directory)}`;
}

/** The prose report: one line per finding, then the counts, or the sentence that says nothing broke. */
function text(found: Found, files: number): string {
  if (files === 0) return `No ${RULE_FILE} is tracked in this checkout, so nothing is restricted.\n`;
  const lines = [
    ...found.imports.map((v) => `${v.from} → ${v.to}${because(v.message, v.directory)}`),
    ...found.chains.map((v) => `${[...v.chain, v.to].join(' → ')}${because(v.message, v.directory)}; ${plural(v.seeds, 'shipped file')} reach${v.seeds === 1 ? 'es' : ''} ${v.from}`),
    ...found.capped.map((v) => `${v.package} is layer ${v.layer}, above the ceiling of ${v.maxLayer}${because(v.message, v.directory)}`),
    ...found.tiers.violated.map((v) => budgetLine(v, 'over')),
    ...found.tiers.undecided.map((v) => `${budgetLine(v, 'within')}; undecided`),
  ];
  const counts = [
    found.imports.length > 0 ? `${plural(found.imports.length, 'restricted import')}` : '',
    found.chains.length > 0 ? `${plural(found.chains.length, 'restricted chain')}` : '',
    found.capped.length > 0 ? `${plural(found.capped.length, 'package')} above a layer ceiling` : '',
    found.tiers.violated.length > 0 ? `${plural(found.tiers.violated.length, 'package')} over a tier budget` : '',
    found.tiers.undecided.length > 0 ? `${plural(found.tiers.undecided.length, 'package')} undecided` : '',
  ].filter((part) => part !== '');
  if (lines.length === 0) return `Nothing breaks the rules in ${plural(files, `${RULE_FILE} file`)}.\n`;
  return `${lines.join('\n')}\n${counts.join(', ')}.\n`;
}

/** Runs the check over the published source index and returns the report with its exit code: 1 on any violation. */
export async function restrictionsOutput(request: ParsedRestrictions): Promise<{ out: string; code: ExitCode }> {
  const tiers = readTiers(request.root);
  const files = ruleFiles(request.root, tiers);
  const published = await publishedSources(request.root, {
    ci: isCI,
    step: 'variance index',
    announce: (line) => process.stderr.write(`variance: ${line}\n`),
  });
  const found: Found = {
    imports: restrictedImports(published.records, files),
    chains: restrictedChains(published.records, files, seeds(request.root, files)),
    capped: cappedPackages(request.root, files),
    tiers: budgeted(request.root, files, tiers),
  };
  const out = request.format === 'json'
    ? `${JSON.stringify({ violations: found.imports, chains: found.chains, capped: found.capped, tiers: found.tiers })}\n`
    : text(found, files.length);
  const failed = found.imports.length + found.chains.length + found.capped.length + found.tiers.violated.length > 0;
  return { out, code: failed ? EXIT_REVIEW : EXIT_CLEAN };
}
