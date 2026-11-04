import { resolve } from 'node:path';
import type { Help } from '@variance-authority/package/help';
import { sourceIndexPath } from '@variance-authority/sense';
import { operatorError } from './operator.js';
import { readWorkspace, readWorkspaceForAnswer, workspaceSnapshotPath, type AnsweringOptions } from './read.js';
import type { SearchIndex } from './search-index.js';
import { readSearchSnapshot, readSearchTree, readWorkspaceSnapshot, searchOf, workspaceSearchPath } from './snapshot.js';

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
   * counted against as `uses` counts them. Read when first asked for and kept:
   * opened beside a published search, it is the parse the search file exists to
   * spare, so the shell asks for it only for a row it counts.
   */
  readonly value: () => Promise<ValueRead>;
}

/** The value a search was written from, or why the published one did not open; neither when none is published. */
export interface ValueRead {
  readonly help?: Help;
  readonly unopened?: Unopened;
}

/** A value already in hand, as {@link SearchReading.value} hands it over. */
const held = (help: Help): (() => Promise<ValueRead>) => () => Promise.resolve({ help });

/** `read`, run the first time the thunk is called and never again. */
function once<T>(read: () => Promise<T>): () => Promise<T> {
  let pending: Promise<T> | undefined;
  return () => (pending ??= read());
}

/** A published file the reading tried, and why it did not open. */
export interface Unopened {
  /** The published search, or the published value it is written from. */
  readonly published: 'search' | 'value';
  readonly at: string;
  readonly reason: string;
}

/**
 * The sentence an answer carries when a published file did not open: which,
 * why, and what was read instead. Absent when nothing failed to open.
 */
export function unopenedLine(unopened: readonly Unopened[] | undefined, compared: boolean): string | undefined {
  if (unopened === undefined) return undefined;
  // Only the value unopened beside a search that opened: the search answered, with the counts it carries.
  const searched = !compared && unopened.every(({ published }) => published === 'value');
  const instead = compared ? 'the checkout' : searched ? 'the published search, with the counts it carries,' : 'the published value';
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
 * question after them expects to find their output. So the published search is
 * opened in place at any age — not the value, not the checkout, and the graph
 * only when a start point was said. A search missing beside a published value
 * is written from that value, which reads no source. With neither, there is
 * nothing to look up: the checkout is read and the search published, as any
 * source question reads it, unless `--just-answer` was asked, which forbids the
 * read — and only then is the question refused, naming the flag that refused it.
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
    const help = await readWorkspaceForAnswer(root, options);
    return { index: await searchOf(help, index), compared: !justAnswer, value: held(help) };
  }

  const searchAt = workspaceSearchPath(index);
  let unopened: Unopened[] | undefined;
  try {
    const search = await readSearchSnapshot(root, reading.index);
    if (reading.tree !== undefined) reading.tree(await readSearchTree(search, root, reading.index));
    // The value is opened only for a published row shown; without one the search answers with the counts it carries, and says why.
    const value = once(async (): Promise<ValueRead> => {
      try {
        return { help: await readWorkspaceSnapshot(root, reading.index === undefined ? {} : { index: reading.index }) };
      } catch (error) {
        return absent(error) ? {} : { unopened: { published: 'value', at: workspaceSnapshotPath(index), reason: reasonOf(error) } };
      }
    });
    return { index: search, compared: false, value };
  } catch (error) {
    // Not published says nothing; published and unopenable is said with the answer.
    if (!absent(error)) unopened = [{ published: 'search', at: searchAt, reason: reasonOf(error) }];
  }
  // The value is opened at any age, as the search is: how old a reused one may be is the other questions' rule.
  let help: Help;
  try {
    help = await readWorkspaceForAnswer(root, { ...reading, justAnswer: true });
  } catch (cause) {
    // Asked with `justAnswer`, the value's own error is the cause of the refusal around it.
    const own = cause instanceof Error && cause.cause !== undefined ? cause.cause : cause;
    if (!absent(own)) unopened = [...(unopened ?? []), { published: 'value', at: workspaceSnapshotPath(index), reason: reasonOf(own) }];
    if (justAnswer) {
      const tried = unopened === undefined
        ? `none is published at ${searchAt}`
        : unopened.map(({ published, at, reason }) => `the published ${published} at ${at} did not open (${reason})`).join(', and ');
      throw operatorError(
        `search reads the published source generation, and ${tried}; ` +
          'it was asked with `--just-answer`, so the checkout was not read. Run `variance index` to publish one.',
        { cause },
      );
    }
    const read = await readWorkspace(root, reading);
    return { index: await searchOf(read, index), compared: true, value: held(read), ...(unopened === undefined ? {} : { unopened }) };
  }
  return { index: await searchOf(help, index), compared: false, value: held(help), ...(unopened === undefined ? {} : { unopened }) };
}
