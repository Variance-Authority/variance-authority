// compass: variance-authority.reach
/**
 * What tells over which text of each asked file one run ran, for the cases of
 * a test file that run last ran (`covering-ran.ts`), read once per question:
 * the committed texts where the runs stood, the kept texts behind the digests
 * the runs name, and, for the one run that wrote a snapshot naming no commit,
 * the snapshot's rows. Sense's `ranOver` reads the verdict from them. The asked
 * region is placed once per pair of texts compared, however many runs ran over
 * the same one.
 */

import { realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import {
  keptTexts,
  placeAcross,
  placeInTexts,
  readsTheSnapshot,
  readTextsAt,
  type HeldLines,
  type NotHeld,
  type Placement,
  type RanOverEvidence,
  type TestPlace,
} from '@variance-authority/sense/test-selection';
import { digestString } from '@variance-authority/core/format';

/**
 * The asked region of the held text, in its lines: the line or lines asked,
 * or the asked function's blocks placed in it, none when an edit removed the
 * function. A function written inside the asked one lies inside its block, so
 * an edit that removed only the inner one moved the outer one, which is placed.
 */
export type Region = { readonly held: readonly HeldLines[] } | { readonly unknown: string } | undefined;

/** What the verdicts are read from, read once for every run: what tells which text each ran over, and how a region moved across two. */
export interface Evidence extends RanOverEvidence {
  /** How lines of a held text are placed in a text a run ran over, placed once per pair of texts. */
  readonly across: (held: string, ran: string) => Placement['place'];
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
 * stood at, which asked files those commits lack, git's reason for each it
 * could not read, the kept texts the runs name when a region is asked, and the
 * snapshot's placements when a run wrote it — the question's own for one
 * file, else read for each held text.
 */
export async function evidenceOf(runs: readonly TestPlace[], held: ReadonlyMap<string, string>, question: EvidenceQuestion): Promise<Evidence> {
  const { root, repository, last } = question;
  const files = [...held.keys()];
  // A run the record could not place stood nowhere it says, so nothing is read where it is assumed to.
  const placed = runs.filter((run) => run.assumed !== true);
  const committed = new Map<string, Map<string, string>>();
  const absent = new Map<string, Set<string>>();
  const refused = new Map<string, Map<string, string>>();
  if (repository !== undefined) {
    const under = relative(await realpath(repository), await realpath(root));
    const repoPath = (file: string): string => (under === '' ? file : join(under, file).split(sep).join('/'));
    const commits = [...new Set(placed.flatMap((run) => run.commit ?? []))];
    const read = readTextsAt(repository, new Map(commits.map((commit) => [commit, files.map(repoPath)])));
    for (const commit of commits) {
      const texts = read.texts.get(commit);
      const why = read.refused.get(commit);
      committed.set(commit, new Map(files.flatMap((file) => {
        const text = texts?.get(repoPath(file));
        return text === undefined ? [] : [[file, text] as const];
      })));
      // A file git neither read nor refused is one the commit's tree does not list.
      const refusals = files.flatMap((file) => {
        const reason = why?.get(repoPath(file));
        return reason === undefined ? [] : [[file, reason] as const];
      });
      if (refusals.length > 0) refused.set(commit, new Map(refusals));
      const lacks = files.filter((file) => texts?.get(repoPath(file)) === undefined && why?.get(repoPath(file)) === undefined);
      if (lacks.length > 0) absent.set(commit, new Set(lacks));
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
  // Runs that ran over the same text compare the same pair, so each pair is placed once.
  const pairs = new Map<string, Placement['place']>();
  const across = (from: string, to: string): Placement['place'] => {
    const key = `${digestString(from)} ${digestString(to)}`;
    const place = pairs.get(key) ?? placeAcross(from, to);
    pairs.set(key, place);
    return place;
  };
  return { repository: repository !== undefined, committed, absent, refused, kept, last, placements, ranOther: question.ranOther, across };
}

/**
 * Whether the asked region of `held` is the same in what a run ran over, the
 * text found or none where the file did not exist; absent when no region is
 * asked, and `gone` when the asked function is not in `held` at all.
 */
export function regionVerdict(
  region: Region,
  held: string,
  over: NotHeld,
  file: string,
  evidence: Evidence,
): 'same' | 'changed' | 'gone' | { readonly unknown: string } | undefined {
  if (region === undefined || 'unknown' in region) return region;
  if (region.held.length === 0) return 'gone';
  // A file that did not exist held no text the region is in.
  if (over === 'absent') return 'changed';
  const ran = over.text;
  if (ran === undefined) return { unknown: `the text of ${file} that run ran over is neither kept nor committed` };
  const place = evidence.across(held, ran);
  return region.held.every((range) => place(range)?.moved === false) ? 'same' : 'changed';
}
