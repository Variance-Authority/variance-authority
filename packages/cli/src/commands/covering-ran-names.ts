// compass: variance-authority.reach
/**
 * Which text a `covering` question holds for each asked file, and the names
 * that say whether a run ran over it: the source index's for a text on disk,
 * git's own for a text handed in, beside the name of the text the record's
 * rows were cut from.
 */

import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { ExecutionIndex, HeldNames } from '@variance-authority/sense/test-selection';
import type { RanNamed, RanQuestion } from './covering-ran.js';
import { rowsCut, type RowsCut } from './record-rows-text.js';
import { checkoutNames } from './source-graph.js';

/** A held text by its names, or why it has none and so which text ran over it is not known. */
export type Names = HeldNames | { readonly unknown: string };

/**
 * The held text of each asked file that has one: the one handed in for a
 * question about one file, each changed file's on disk under `--since`.
 */
export async function heldTexts(question: RanQuestion, answer: RanNamed, asked: readonly string[]): Promise<ReadonlyMap<string, string>> {
  const texts = answer.changed === undefined
    ? asked.map((file) => [file, question.held] as const)
    : await Promise.all(asked.map(async (file) => [file, await readFile(resolve(question.root, file), 'utf8').catch(() => undefined)] as const));
  return new Map(texts.flatMap(([file, text]) => (text === undefined ? [] : [[file, text] as const])));
}

/**
 * Each held file's names, as `coverage` names the checkout's texts: the source
 * index's git blob name for a text on disk, brought up to the checkout first
 * and read for the held files alone,
 * and git's own for a text handed in; with its digest when the record's rows
 * were cut from the same text. And the git blob name of the text each file's
 * rows were cut from, where the record names one. A file the index cannot name
 * has none, and which text ran over it is not known, with the reason.
 */
export async function namesOf(question: RanQuestion, snapshot: string, held: ReadonlyMap<string, string>): Promise<{
  readonly names: ReadonlyMap<string, Names>;
  readonly rows: ReadonlyMap<string, string>;
}> {
  const now = question.handed === true ? handedNames(question.root, held) : await checkoutNames(question.root, [...held.keys()]);
  const cut = cutsOf(snapshot, [...held.keys()], question.index);
  if ('unread' in cut) return { names: new Map([...held.keys()].map((file) => [file, { unknown: `which text ran is not known: ${cut.unread}` }])), rows: new Map() };
  const cuts = cut.cuts;
  const rows = new Map([...cuts].flatMap(([file, cut]) => ('unknown' in cut || cut.blob === undefined ? [] : [[file, cut.blob] as const])));
  const names = new Map([...held.keys()].map((file): readonly [string, Names] => {
    if ('missed' in now) return [file, { unknown: `which text ran is not known: ${now.missed}` }];
    const blob = now.get(file);
    if (blob === undefined) return [file, { unknown: `the source index does not hold ${file}, so which text ran over it is not known` }];
    const cut = cuts.get(file);
    return [file, { blob, digest: cut !== undefined && !('unknown' in cut) && cut.blob === blob ? cut.digest : undefined }];
  }));
  return { names, rows };
}

/** The git blob name of each text handed in, as git names it at its path, or why git could not name it. */
function handedNames(root: string, held: ReadonlyMap<string, string>): ReadonlyMap<string, string> | { readonly missed: string } {
  try {
    return new Map([...held].map(([file, text]) => [file, `git:${execFileSync('git', ['hash-object', '--stdin', '--path', file], { cwd: root, input: text, encoding: 'utf8' }).trim()}`] as const));
  } catch (error) {
    return { missed: `git could not name the text handed in: ${error instanceof Error ? error.message : String(error)}` };
  }
}

/** The text the snapshot's rows of each file were cut from ({@link rowsCut}), or why the snapshot's rows do not read. */
function cutsOf(snapshot: string, files: readonly string[], index: ExecutionIndex | undefined): { readonly cuts: ReadonlyMap<string, RowsCut> } | { readonly unread: string } {
  try {
    return { cuts: rowsCut(snapshot, files, index ?? { tests: [], modules: [] }) };
  } catch (error) {
    return { unread: `the record's rows do not read: ${error instanceof Error ? error.message : String(error)}` };
  }
}
