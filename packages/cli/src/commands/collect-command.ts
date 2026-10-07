// compass: variance-authority.report.shard-merge
import { encodeSuiteIndex } from '@variance-authority/report/suite-index';
import type { ParsedCollect } from '../collect-args.js';
import type { Config } from '../config.js';
import { EXIT_CLEAN, EXIT_OPERATOR, OperatorError, type ExitCode } from '../exit.js';
import { said } from '../here.js';
import { settle } from '../settle.js';
import { collectEvidence } from './collect.js';
import { mergeEvidence, type FailedSubject, type Named } from './collect-merge.js';
import { collectorPath, loadCollector, planFor, type Collector, type CollectorContext } from './collector.js';
import { evidenceIdentity } from './evidence-identity.js';
import { encodeEvidencePart, readEvidencePart, type EvidenceDiagnostic } from './evidence-part.js';
import { liveIgnores } from './ignores.js';
import { scanSourceDirs } from './source-graph.js';

/**
 * The two halves of `variance collect`, as the binary runs them.
 *
 * A job reads its shard of the plan into a part and writes it; nothing is
 * compared and no baseline is read. The merge reads every part, and publishes
 * the suite index only when the parts are one whole collection with nothing
 * failed. Otherwise the index already at `--out` stays as it was, because a
 * partial index read as the whole suite would answer every lookup it is missing
 * with "not here".
 */

type Streams = { out(text: string): void; err(text: string): void };
type Collecting = Extract<ParsedCollect, { operation?: undefined }>;
type Merging = Extract<ParsedCollect, { operation: 'merge' }>;

export interface CollectDeps {
  readonly cwd: string;
  readonly load: (path: string, context: CollectorContext) => Promise<Collector>;
}

const LIVE: CollectDeps = { cwd: process.cwd(), load: loadCollector };

export async function runCollect(parsed: Collecting, config: Config, streams: Streams, deps: CollectDeps = LIVE): Promise<ExitCode> {
  // The rules still live today, as `run` hands them over: an expired ignore
  // stops hiding a subtree from the evidence the day it stops hiding pixels.
  const effective: Config = {
    ...config,
    ...(parsed.workers === undefined ? {} : { workers: parsed.workers }),
    ...(config.ignore === undefined ? {} : { ignore: liveIgnores(config.ignore, new Date().toISOString()) }),
  };
  const [plan, identity] = await Promise.all([planFor(effective), evidenceIdentity(effective, deps.cwd)]);
  const dirs = effective.source?.dirs ?? [];
  const source = dirs.length === 0 ? undefined : await scanSourceDirs(deps.cwd, dirs);
  const collector = await deps.load(collectorPath(effective.subjects), { config: effective, ...(plan === undefined ? {} : { plan }) });

  const collected = await collectEvidence({
    collector,
    config: effective,
    ...(parsed.shard === undefined ? {} : { shard: parsed.shard }),
    ...(parsed.subjects === undefined ? {} : { scope: parsed.subjects }),
    ...(source === undefined ? {} : { source }),
    build: identity.build,
    recipe: identity.recipe,
  });
  const part = { ...collected, diagnostics: [...identity.diagnostics, ...collected.diagnostics] };
  await settle(parsed.out, encodeEvidencePart(part));

  const failed = part.outcomes.filter((outcome) => outcome.outcome === 'failed');
  const done = part.outcomes.length - failed.length;
  const shard = parsed.shard === undefined ? 'the whole plan' : `shard ${String(parsed.shard.index)}/${String(parsed.shard.total)}`;
  streams.out(
    `${said(parsed.out)}: ${shard} owns ${String(part.outcomes.length)} of ${String(part.plan.subjects.length)} subjects; ` +
      `${String(done)} read, ${String(failed.length)} failed\n`,
  );
  for (const outcome of failed) if (outcome.outcome === 'failed') streams.err(`${outcome.subject} failed: ${outcome.because}\n`);
  report(identity.diagnostics, streams);
  return EXIT_CLEAN;
}

export async function runCollectMerge(parsed: Merging, streams: Streams): Promise<ExitCode> {
  const named: Named[] = [];
  for (const path of parsed.parts) {
    const part = await readEvidencePart(path);
    if (typeof part === 'string') throw new OperatorError(`${part}; ${said(parsed.out)} is left as it was`);
    named.push({ path: said(path), part });
  }

  const merged = mergeEvidence(named);
  if (merged.kind === 'refused') throw new OperatorError(`${merged.because}; ${said(parsed.out)} is left as it was`);
  report(merged.diagnostics, streams);

  const bytes = encodeSuiteIndex(merged.index);
  if (merged.failed.length > 0) {
    const kept = `${parsed.out}.incomplete`;
    await settle(kept, bytes);
    for (const failed of merged.failed) streams.err(`${failed.subject} failed: ${failed.because}; collect it again with ${rerun(failed)}\n`);
    streams.err(
      `${said(parsed.out)} is left as it was: ${String(merged.failed.length)} of ${String(merged.index.coverage?.length ?? 0)} subjects failed. ` +
        `What the parts hold is in ${said(kept)}; merge again once every shard reads whole.\n`,
    );
    return EXIT_OPERATOR;
  }

  await settle(parsed.out, bytes);
  const subjects = merged.index.subjects.length;
  streams.out(
    subjects === 0 && (merged.index.coverage?.length ?? 0) === 0
      ? `the plan holds no subjects; wrote an empty index to ${said(parsed.out)}\n`
      : `wrote ${said(parsed.out)}: ${String(subjects)} subjects, ${String(merged.index.components.length)} components, from ${String(named.length)} ${named.length === 1 ? 'part' : 'parts'}\n`,
  );
  return EXIT_CLEAN;
}

function rerun(failed: FailedSubject): string {
  return failed.shard === undefined ? '`variance collect`' : `\`variance collect --shard ${String(failed.shard.index)}/${String(failed.shard.total)}\``;
}

function report(diagnostics: readonly EvidenceDiagnostic[], streams: Streams): void {
  for (const diagnostic of diagnostics) {
    streams.err(`${diagnostic.severity}: ${diagnostic.subject === undefined ? '' : `${diagnostic.subject}: `}${diagnostic.message}\n`);
  }
}
