// compass: variance-authority.reach
/**
 * Over which text of each asked file one run ran, for the cases of a test file
 * that run last ran (`covering-ran.ts`). Everything it is read from is read
 * once per question: the committed texts where the runs stood, the kept texts
 * behind the digests the runs name, and, for the one run that wrote a
 * snapshot naming no commit, the snapshot's rows.
 */

import { realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { keptTexts, placeAcross, placeInTexts, textsAt, type HeldLines, type Placement, type TestPlace } from '@variance-authority/sense/test-selection';
import { digestString } from '@variance-authority/core/format';

/**
 * What one run ran over of one asked file: the held text, another, given when
 * it is found, or why that is not known.
 */
export type RanOver = 'held' | { readonly text: string | undefined } | { readonly unknown: string };

/**
 * The asked region of the held text, in its lines: the line or lines asked,
 * or the asked function's blocks placed in it, none when an edit removed the
 * function. A function written inside the asked one lies inside its block, so
 * an edit that removed only the inner one moved the outer one, which is placed.
 */
export type Region = { readonly held: readonly HeldLines[] } | { readonly unknown: string } | undefined;

/** What the verdicts are read from, read once for every run. */
export interface Evidence {
  /** Whether the checkout is in a git repository, so a committed text can be read. */
  readonly repository: boolean;
  /** The committed text of each asked file at each run's commit, by the asked name; a file the commit lacks is absent. */
  readonly committed: ReadonlyMap<string, ReadonlyMap<string, string>>;
  /** The text behind each digest a run names that the record keeps, read when a line or a function is asked. */
  readonly kept: ReadonlyMap<string, string>;
  /** When the run that wrote a snapshot naming no commit landed: its rows are the record of the texts it ran over. */
  readonly last: string | undefined;
  /** How each asked file's recorded lines stand in its held text, where the snapshot holds an instrumented row of it. */
  readonly placements: ReadonlyMap<string, Placement>;
  /** Under a precondition answer: the test files whose own digest of the file is of another text. */
  readonly ranOther: ReadonlyMap<string, readonly string[]> | undefined;
}

/** What reading the evidence is handed. */
export interface EvidenceQuestion {
  readonly root: string;
  readonly snapshot: string;
  readonly repository: string | undefined;
  /** When the runs record's latest run landed, under a snapshot that names no commit. */
  readonly last: string | undefined;
  /** Whether a line or a function is asked, so the kept texts are read. */
  readonly region: boolean;
  /** The question's own placement of its one file. */
  readonly placement: Placement | undefined;
  readonly ranOther: ReadonlyMap<string, readonly string[]> | undefined;
}

/**
 * Read what the runs' verdicts need: the committed texts at every commit a run
 * stood at, the kept texts the runs name when a region is asked, and the
 * snapshot's placements when a run wrote it — the question's own for one
 * file, else read for each held text.
 */
export async function evidenceOf(runs: readonly TestPlace[], held: ReadonlyMap<string, string>, question: EvidenceQuestion): Promise<Evidence> {
  const { root, repository, last } = question;
  const files = [...held.keys()];
  // A run the record could not place stood nowhere it says, so nothing is read where it is assumed to.
  const placed = runs.filter((run) => run.assumed !== true);
  const committed = new Map<string, Map<string, string>>();
  if (repository !== undefined) {
    const under = relative(await realpath(repository), await realpath(root));
    const repoPath = (file: string): string => (under === '' ? file : join(under, file).split(sep).join('/'));
    const commits = [...new Set(placed.flatMap((run) => run.commit ?? []))];
    const blobs = textsAt(repository, new Map(commits.map((commit) => [commit, files.map(repoPath)])));
    for (const commit of commits) {
      const texts = blobs.get(commit);
      committed.set(commit, new Map(files.flatMap((file) => {
        const text = texts?.get(repoPath(file));
        return text === undefined ? [] : [[file, text] as const];
      })));
    }
  }
  const kept = new Map<string, string>();
  if (question.region) {
    const keptText = keptTexts(root);
    for (const digest of new Set(placed.flatMap((run) => files.flatMap((file) => run.texts?.[file] ?? [])))) {
      const text = keptText(digest);
      if (text !== undefined) kept.set(digest, text);
    }
  }
  const placements = !placed.some((run) => readsTheSnapshot(run, last))
    ? new Map<string, Placement>()
    : question.placement !== undefined && files.length === 1
      ? new Map([[files[0]!, question.placement]])
      : placeInTexts(question.snapshot, root, held);
  return { repository: repository !== undefined, committed, kept, last, placements, ranOther: question.ranOther };
}

/**
 * The run that wrote a snapshot naming no commit: the record's latest landing,
 * outside a checkout, which names no texts, so the snapshot's rows are the
 * record of which text its cases ran over. An earlier landing's rows a later
 * run may have written over.
 */
function readsTheSnapshot(run: TestPlace, last: string | undefined): boolean {
  return last !== undefined && run.commit === undefined && run.texts === undefined && run.assumed !== true && run.latest === last;
}

/**
 * Whether `run` ran over `text` of `file`, the text it ran over instead when
 * that is found, or why that is not known. A run whose record names its texts
 * ran over the one it names, else over the committed one; one observed without
 * naming them ran over a text the record does not know; one the record could
 * not place, over a text it cannot say; the one that wrote a snapshot naming
 * no commit, over its rows'.
 */
export function ranOver(run: TestPlace, test: string, file: string, text: string, evidence: Evidence, precondition: boolean): RanOver {
  if (run.assumed === true) return { unknown: `the record does not say where that run stood, so not which text of ${file} it ran over` };
  if (readsTheSnapshot(run, evidence.last)) return fromSnapshot(test, file, evidence, precondition);
  if (run.texts === undefined) return { unknown: `the runs record does not say which text of ${file} its runs there ran over` };
  const digest = digestString(text);
  const committed = run.commit === undefined ? undefined : evidence.committed.get(run.commit)?.get(file);
  const named = run.texts[file];
  if (named !== undefined) {
    if (named === digest) return 'held';
    return { text: evidence.kept.get(named) ?? (committed !== undefined && digestString(committed) === named ? committed : undefined) };
  }
  if (committed !== undefined) return digestString(committed) === digest ? 'held' : { text: committed };
  return {
    unknown: run.commit === undefined
      ? `that run stood at no commit, so no committed text of ${file} can be read`
      : evidence.repository
        ? `this clone holds no committed text of ${file} where that run stood`
        : `the checkout is in no git repository, so no committed text of ${file} can be read`,
  };
}

/**
 * The text the snapshot's rows say `test` ran over: an instrumented file's
 * row digest, through the placement of its lines in the held text, and a
 * precondition's digest, which the record keeps per test file.
 */
function fromSnapshot(test: string, file: string, evidence: Evidence, precondition: boolean): RanOver {
  if (precondition) return evidence.ranOther?.get(file)?.includes(test) === true ? { text: undefined } : 'held';
  const placement = evidence.placements.get(file);
  if (placement === undefined) return { unknown: `the record holds no digest of the text of ${file} it ran over` };
  return placement.frame === 'recorded' ? 'held' : { text: placement.recorded };
}

/**
 * Whether the asked region of `held` is the same in `ran`, the text a run ran
 * over; absent when no region is asked, and `gone` when the asked function is
 * not in `held` at all.
 */
export function regionVerdict(region: Region, held: string, ran: string | undefined, file: string): 'same' | 'changed' | 'gone' | { readonly unknown: string } | undefined {
  if (region === undefined || 'unknown' in region) return region;
  if (region.held.length === 0) return 'gone';
  if (ran === undefined) return { unknown: `the text of ${file} that run ran over is neither kept nor committed` };
  const place = placeAcross(held, ran);
  return region.held.every((range) => place(range)?.moved === false) ? 'same' : 'changed';
}
