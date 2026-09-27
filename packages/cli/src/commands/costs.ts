import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { firstShared, shareKey } from '@variance-authority/core/share';
import type { Config } from '../config.js';
import { suiteIndexRoot } from './resources.js';
import { isShardFilter, type CliRunReport } from './run-report.js';
import { lineageOf, shareFor } from './share.js';
import type { Costs } from './shard.js';

/**
 * What each subject cost the last mainline run, and where the next run finds it.
 *
 * Beside the suite index and not inside it. The index is a fact about a commit
 * — two machines composing one tree write it byte for byte — and a timing is a
 * fact about one machine on one afternoon, so folding it in would end that
 * equality. It travels the same road instead: under the commit, in
 * `<cache>/suite/<project>/`, so the cache step that already carries the index
 * in CI carries this with it, and offered to the same share under its own
 * artifact name.
 *
 * Read by the lineage walk the index uses, from the merge base. That is what
 * makes it safe to balance on: every shard of one build descends from the same
 * merge base, so every shard reads the same costs and computes the same
 * placement. A shard that restored a different cache reads a different commit,
 * says which in every exclusion it writes, and the merge refuses the overlap.
 *
 * Nothing here can fail a run. A cost that is not found places by checksum,
 * which is what a run without one always did.
 */

const SUBJECT_COSTS = 'subject-costs-v1';
const DEFAULT_MAINLINE = 'origin/main';
const DEFAULT_DEPTH = 50;

interface CostsFile {
  readonly version: 1;
  readonly commit: string;
  /** Subject id to whole milliseconds, keys in code-unit order. */
  readonly costs: Readonly<Record<string, number>>;
}

export function costsPath(config: Pick<Config, 'project' | 'cacheRoot'>, commit: string): string {
  return join(suiteIndexRoot(config), config.project, `${commit}.costs.json`);
}

/** Every observed subject's `costMs`, rounded; a subject with none is left out. */
export function costsOf(report: Pick<CliRunReport, 'observations'>): Costs {
  const costs = new Map<string, number>();
  for (const observation of report.observations) {
    if (observation.costMs !== undefined) costs.set(observation.subject, Math.round(observation.costMs));
  }
  return costs;
}

function encode(commit: string, costs: Costs): Uint8Array {
  const ids = [...costs.keys()].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const file: CostsFile = {
    version: 1,
    commit,
    costs: Object.fromEntries(ids.map((id) => [id, costs.get(id)!])),
  };
  return new TextEncoder().encode(`${JSON.stringify(file, null, 2)}\n`);
}

function decode(bytes: Uint8Array): Costs | null {
  try {
    const file = JSON.parse(new TextDecoder().decode(bytes)) as Partial<CostsFile>;
    if (file.version !== 1 || typeof file.costs !== 'object' || file.costs === null) return null;
    const costs = new Map<string, number>();
    for (const [id, ms] of Object.entries(file.costs)) {
      if (typeof ms === 'number' && Number.isFinite(ms) && ms >= 0) costs.set(id, ms);
    }
    return costs;
  } catch {
    return null;
  }
}

/**
 * Write this report's costs under its commit, and offer them to the share; or
 * the sentence saying why not.
 *
 * The rule the suite index keeps: a report with no commit publishes nothing,
 * because costs addressed by a guess would balance the next build on them. A
 * shard's report publishes nothing either — it timed a slice, and a slice
 * written under the commit would price every other shard's files at the
 * median. The shards' merge is the whole suite, and `share --publish` takes it.
 */
export async function publishCosts(
  config: Config,
  report: CliRunReport,
): Promise<{ readonly commit: string; readonly subjects: number } | string> {
  const commit = report.run?.commit;
  const costs = costsOf(report);
  if (commit === undefined) return 'no subject costs published: this report names no commit';
  if (report.notObserved?.some(isShardFilter) === true) {
    return 'no subject costs published: this report is one shard; publish the shards together';
  }
  if (costs.size === 0) return 'no subject costs published: this report timed no subject';

  const bytes = encode(commit, costs);
  try {
    const path = costsPath(config, commit);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
  } catch {
    // A cache this machine could not write is a cache this machine does without.
  }
  await shareFor(config)?.put(shareKey({ project: config.project, artifact: SUBJECT_COSTS, commit }), bytes);
  return { commit, subjects: costs.size };
}

export interface MainlineCosts {
  readonly commit: string;
  readonly behind: number;
  readonly costs: Costs;
}

/** The newest costs this checkout's lineage holds, local first, then the share. */
export async function mainlineCosts(
  config: Config,
  options: { readonly ref?: string; readonly cwd?: string } = {},
): Promise<MainlineCosts | null> {
  const lineage = await lineageOf(
    options.ref ?? config.share?.mainline ?? DEFAULT_MAINLINE,
    config.share?.depth ?? DEFAULT_DEPTH,
    options.cwd ?? process.cwd(),
  );

  for (let behind = 0; behind < lineage.length; behind += 1) {
    const commit = lineage[behind]!;
    let bytes: Uint8Array;
    try {
      bytes = await readFile(costsPath(config, commit));
    } catch {
      continue;
    }
    const costs = decode(bytes);
    if (costs !== null) return { commit, behind, costs };
  }

  const share = shareFor(config);
  if (share === undefined) return null;
  const hit = await firstShared(share, lineage, (commit) =>
    shareKey({ project: config.project, artifact: SUBJECT_COSTS, commit }),
  );
  const costs = hit === null ? null : decode(hit.bytes);
  if (hit === null || costs === null) return null;
  try {
    const path = costsPath(config, hit.commit);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, hit.bytes);
  } catch {
    // Kept when it can be, so the next command does not ask again.
  }
  return { commit: hit.commit, behind: hit.behind, costs };
}

/** What `share --publish` says about costs: where they went, or why they did not. */
export async function costsLine(config: Config, report: CliRunReport): Promise<string> {
  const published = await publishCosts(config, report);
  if (typeof published === 'string') return published;
  const shared = shareFor(config) === undefined ? '' : ' (published)';
  return `subject costs of ${published.subjects} subject(s): ${costsPath(config, published.commit)}${shared}`;
}

/**
 * What a run prints about its costs, empty when there is nothing to say — the
 * way `publishedLine` says nothing about a suite index a run with no commit
 * could not address.
 */
export async function publishedCostsLine(config: Config, report: CliRunReport): Promise<string> {
  const published = await publishCosts(config, report);
  if (typeof published === 'string') return '';
  return `subject costs: ${costsPath(config, published.commit)}${shareFor(config) === undefined ? '' : ' (published)'}\n`;
}
