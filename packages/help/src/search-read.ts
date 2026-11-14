import { resolve } from 'node:path';
import type { Help } from '@variance-authority/package/help';
import { sourceIndexPath } from '@variance-authority/sense';
import { operatorError } from './operator.js';
import { UnsavedRead, readWorkspace, readWorkspaceForAnswer, type AnsweringOptions } from './read.js';
import { readWorkspaceSnapshot, workspaceSnapshotPath } from './snapshot.js';
import type { SearchIndex } from './search-index.js';
import { searchIndexOf } from './tools/search.js';

/** A search, and whether it was read from the checkout as it is now. */
export interface SearchReading {
  readonly index: SearchIndex;
  /**
   * True when the checkout was read for this question; false when a published
   * search or value was opened at whatever age it had, which nothing compared
   * with the checkout.
   */
  readonly compared: boolean;
  /**
   * Each published file that was there and did not open, and why, in the
   * order they were tried; absent when nothing published failed to open. A
   * file that is not there is not in it: that is nothing published, not a
   * failure.
   */
  readonly unopened?: readonly Unopened[];
  /**
   * The value the search was written from, which the published rows shown are
   * counted against as `uses` counts them; the shell asks for it only for a row
   * it counts.
   */
  readonly value: () => Promise<ValueRead>;
}

/** The value a search was written from. */
export interface ValueRead {
  readonly help?: Help;
}

/** A value already in hand, as {@link SearchReading.value} hands it over. */
const held = (help: Help): (() => Promise<ValueRead>) => () => Promise.resolve({ help });

/** A published file the reading tried, and why it did not open. */
export interface Unopened {
  /** The published value, which holds the search. */
  readonly published: 'value';
  readonly at: string;
  readonly reason: string;
}

/**
 * The sentence an answer carries when a published file did not open: which,
 * why, and what was read instead. Absent when nothing failed to open.
 */
export function unopenedLine(unopened: readonly Unopened[] | undefined, compared: boolean): string | undefined {
  if (unopened === undefined) return undefined;
  const instead = compared ? 'the checkout' : 'the published value';
  const tried = unopened.map(({ published, at, reason }) => `The published ${published} at ${at} did not open (${reason})`);
  return `${tried.join('. ')}; ${instead} was read instead.`;
}

/** Whether `error`, or anything it was caused by, says the file is not there. */
function absent(error: unknown): boolean {
  for (let at: unknown = error; at instanceof Error; at = at.cause) {
    if ((at as NodeJS.ErrnoException).code === 'ENOENT') return true;
  }
  return false;
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The search over the workspace, opened from what was published, and read
 * from the checkout only when nothing was.
 *
 * Publishing is somebody else's job: in CI the scan and
 * the documentation are brought up to date by the steps before it, and the
 * question after them expects to find their output. So the published store is
 * opened in place at any age — not the checkout, and the graph only when a
 * start point was said. With none, there is nothing to look up: the checkout is
 * read and the store published, as any source question reads it, unless
 * `--just-answer` was asked, which forbids the read — and only then is the
 * question refused, naming the flag that refused it.
 *
 * Changed paths or taints are the one exception, because they ask for a new
 * generation by name: that reading is {@link readWorkspaceForAnswer}'s, and it
 * publishes the search it answers from; under `--just-answer` it reads nothing
 * new, so that search is not compared with the checkout either.
 */
export async function readSearchForAnswer(root: string, options: AnsweringOptions = {}): Promise<SearchReading> {
  const { justAnswer = false, refreshAfterMs: _age, ...reading } = options;
  const index = reading.index ?? sourceIndexPath(resolve(root));
  if (reading.changed !== undefined || reading.taints !== undefined) {
    let help: Help;
    try {
      help = await readWorkspaceForAnswer(root, { ...options, refreshAfterMs: 0 });
    } catch (error) {
      if (!(error instanceof UnsavedRead)) throw error;
      const { changed: _, taints: _taints, ...last } = reading;
      help = await readWorkspaceForAnswer(root, { ...last, justAnswer: true });
      return { index: searchIndexOf(help), compared: false, value: held(help) };
    }
    return { index: searchIndexOf(help), compared: !justAnswer, value: held(help) };
  }

  const at = workspaceSnapshotPath(index);
  let unopened: Unopened[] | undefined;
  try {
    // The value opens in place: a name it holds is decoded when a question reads it, so the search costs what it reads.
    const help = await readWorkspaceSnapshot(root, {
      ...(reading.index === undefined ? {} : { index: reading.index }),
      ...(reading.tree === undefined ? {} : { tree: reading.tree }),
    });
    return { index: searchIndexOf(help), compared: false, value: held(help) };
  } catch (cause) {
    // Not published says nothing; published and unopenable is said with the answer.
    if (!absent(cause)) unopened = [{ published: 'value', at, reason: reasonOf(cause) }];
    if (justAnswer) {
      const tried = unopened === undefined
        ? `none is published at ${at}`
        : unopened.map(({ published, at: where, reason }) => `the published ${published} at ${where} did not open (${reason})`).join(', and ');
      throw operatorError(
        `search reads the published source generation, and ${tried}; ` +
          'it was asked with `--just-answer`, so the checkout was not read. Run `variance index` to publish one.',
        { cause },
      );
    }
  }
  const read = await readWorkspace(root, reading);
  return { index: searchIndexOf(read), compared: true, value: held(read), ...(unopened === undefined ? {} : { unopened }) };
}
