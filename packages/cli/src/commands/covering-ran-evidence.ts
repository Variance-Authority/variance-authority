// compass: variance-authority.reach
/**
 * What tells over which text of each asked file one run ran, for the cases of
 * a test file that run last ran (`covering-ran.ts`), read once per question:
 * the committed texts where the runs stood, the kept texts behind the digests
 * the runs name, and, for the one run that wrote a snapshot naming no commit,
 * the snapshot's rows. Sense's `ranOver` reads the verdict from them. The edit
 * between two texts compared is read once per pair, however many runs ran over
 * the same one.
 */

import { realpath } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { existedAt } from '@variance-authority/sense';
import {
  blobsAt,
  blocksOfTarget,
  editsBetween,
  keptTexts,
  placeAcross,
  placeInTexts,
  readsTheSnapshot,
  regionTouched,
  textsAt,
  type Edit,
  type ExecutionIndex,
  type HeldNames,
  type HeldLines,
  type NotHeld,
  type Placement,
  type RanOverEvidence,
  type TestPlace,
} from '@variance-authority/sense/test-selection';

/**
 * The asked region of the held text, in its lines, each range with the kind of
 * recorded region it is: the line or lines asked, as each region the record
 * charges them to, or the asked function's blocks placed in it, none when an
 * edit removed the function. A function written inside the asked one lies
 * inside its block, so an edit that removed only the inner one moved the outer
 * one, which is placed.
 */
export type Region = { readonly held: readonly HeldRegion[] } | { readonly unknown: string } | undefined;

/** One range of the asked region in the held text, and the kind of recorded region it is. */
export type HeldRegion = HeldLines & { readonly kind: string };

/**
 * The kinds of the recorded regions the asked lines of `file` are charged to
 * (`blocksOfTarget`), each region placed in the held text, where an edit since
 * the record may have moved it. A line no placed region holds is charged to
 * none, which no edit's reading spares: an edit that touched it changed it.
 */
export function kindsAt(file: string, held: HeldLines, index: ExecutionIndex | undefined, placement: Placement | undefined): readonly string[] {
  const blocks = (index?.modules.find((module) => module.file === file)?.blocks ?? []).flatMap((block) => {
    const lines = placement === undefined ? block : placement.place(block)?.lines;
    return lines === undefined || !block.source ? [] : [{ ...block, startLine: lines.startLine, endLine: lines.endLine }];
  });
  const lines = Array.from({ length: held.endLine - held.startLine + 1 }, (_, at) => held.startLine + at);
  const kinds = new Set(blocksOfTarget(blocks, { file, lines }).map((block) => block.kind));
  return kinds.size === 0 ? [CHARGED_TO_NONE] : [...kinds];
}

/** The kind of a line no recorded region is charged at: no reading of an edit names it spared. */
const CHARGED_TO_NONE = '';

/** What the verdicts are read from, read once for every run: what tells which text each ran over, and how two differ. */
export interface Evidence extends RanOverEvidence {
  /**
   * Where lines of a held text stand in a text a run ran over, placed once per
   * pair of names: whether that text holds a line written since the record.
   */
  readonly across: (held: NamedText, ran: NamedText) => Placement['place'];
  /** The edit `file` went through from one text to another, read once per pair of names. */
  readonly edit: (file: string, from: NamedText, to: NamedText) => Edit;
}

/** A text in hand and the name a reader already holds for it: a digest, or a git blob name. */
export interface NamedText {
  readonly name: string;
  readonly text: string;
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
  /** Commits besides the runs' to read the files at, by name and then by text where it is not the held one. */
  readonly at?: readonly string[];
  /** The git blob name of the text each asked file's rows were cut from, where the record names one. */
  readonly rows: ReadonlyMap<string, string>;
  /** The held texts in hand, which the snapshot's rows are placed in when a run wrote it and the question holds no placement. */
  readonly texts?: ReadonlyMap<string, string>;
}

/**
 * Read what the runs' verdicts need: the committed texts at every commit a run
 * stood at, which asked files those commits lack, the kept texts the runs name when a region is asked, and the
 * snapshot's placements when a run wrote it — the question's own for one
 * file, else read for each held text.
 *
 * A file is read at a commit by name first, and its text only where the
 * commit holds another, so a commit that holds the held text reads no text of
 * it.
 */
export async function evidenceOf(runs: readonly TestPlace[], held: ReadonlyMap<string, HeldNames>, question: EvidenceQuestion): Promise<Evidence> {
  const { root, repository, last } = question;
  const files = [...held.keys()];
  // A run the record could not place stood nowhere it says, so nothing is read where it is assumed to.
  const placed = runs.filter((run) => run.assumed !== true);
  const committed = new Map<string, Map<string, string>>();
  const names = new Map<string, Map<string, string>>();
  const absent = new Map<string, Set<string>>();
  if (repository !== undefined) {
    const under = relative(await realpath(repository), await realpath(root));
    const repoPath = (file: string): string => (under === '' ? file : join(under, file).split(sep).join('/'));
    const commits = [...new Set([...placed.flatMap((run) => run.commit ?? []), ...(question.at ?? [])])];
    const named = files.length === 0 ? new Map<string, Map<string, string>>() : blobsAt(repository, new Map(commits.map((commit) => [commit, files.map(repoPath)])));
    const toRead = (commit: string): string[] => files.filter((file) => {
      const name = named.get(commit)?.get(repoPath(file));
      return name !== undefined && name !== held.get(file)!.blob;
    });
    const blobs = textsAt(repository, new Map(commits.map((commit) => [commit, toRead(commit).map(repoPath)])));
    for (const commit of commits) {
      const texts = blobs.get(commit);
      committed.set(commit, new Map(files.flatMap((file) => {
        const text = texts?.get(repoPath(file));
        return text === undefined ? [] : [[file, text] as const];
      })));
      names.set(commit, new Map(files.flatMap((file) => {
        const name = named.get(commit)?.get(repoPath(file));
        return name === undefined ? [] : [[file, name] as const];
      })));
      // No text or name read is a file the commit lacks, or a commit or a blob this clone lacks: git's tree tells them apart.
      const lacks = files.filter((file) => texts?.get(repoPath(file)) === undefined && names.get(commit)?.get(file) === undefined &&
        existedAt(repository, commit, repoPath(file)) === false);
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
      : placeInTexts(question.snapshot, root, question.texts ?? new Map());
  // Runs that ran over the same text compare the same pair, so each pair is read once.
  const pairs = new Map<string, Placement['place']>();
  const across = (from: NamedText, to: NamedText): Placement['place'] => {
    const key = `${from.name} ${to.name}`;
    const place = pairs.get(key) ?? placeAcross(from.text, to.text);
    pairs.set(key, place);
    return place;
  };
  // The texts are in hand: the reader of edits is handed each by its name, and reads each pair once.
  const inHand = new Map<string, string>();
  const edits = editsBetween(root, undefined, [], { inHand: (file, name) => inHand.get(`${file}\0${name}`) });
  const edit = (file: string, from: NamedText, to: NamedText): Edit => {
    inHand.set(`${file}\0${from.name}`, from.text);
    inHand.set(`${file}\0${to.name}`, to.text);
    return edits(file, from.name, to.name)!;
  };
  return { repository: repository !== undefined, committed, blobs: names, absent, kept, last, placements, ranOther: question.ranOther, rows: question.rows, across, edit };
}

/**
 * Whether the asked region of `held` is the same in what a run ran over, the
 * text found or none where the file did not exist; absent when no region is
 * asked, and `gone` when the asked function is not in `held` at all. The edit
 * between the two texts touched it by the rule a count of what ran over this
 * text reads (`regionTouched`): an edit that does not reach a region's kind,
 * a comment written inside a function, leaves it the same.
 */
export function regionVerdict(
  region: Region,
  held: NamedText,
  over: NotHeld,
  file: string,
  evidence: Evidence,
): 'same' | 'changed' | 'gone' | { readonly unknown: string } | undefined {
  if (region === undefined || 'unknown' in region) return region;
  if (region.held.length === 0) return 'gone';
  // A file that did not exist held no text the region is in.
  if (over === 'absent') return 'changed';
  const { text, name } = over;
  if (text === undefined || name === undefined) return { unknown: `the text of ${file} that run ran over is neither kept nor committed` };
  const edit = evidence.edit(file, held, { name, text });
  return region.held.some((range) => regionTouched(range, [edit])) ? 'changed' : 'same';
}
