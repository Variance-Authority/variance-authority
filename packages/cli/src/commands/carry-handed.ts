/**
 * One read of the line, handed to every job of a run.
 *
 * The mainline's record moves while a run is under way, and a shard re-run a
 * day later reads a line that moved further. A selection reads the record, so
 * two jobs that each ask the line can select from two records, and a slice
 * placed from one is not the slice placed from the other. `hand` reads the line
 * once and writes what it read to a directory the host moves as an artifact;
 * `receive` lays that read in another job's checkout and marks it handed, and
 * no reader there asks the line past it, however far behind the merge base.
 *
 * A manifest always lands in the directory, so a host that moved nothing is
 * told apart from a job that read nothing: `receive` stops on the first rather
 * than ask the line on its own. A suite the manifest lists holds the record, or
 * whatever stopped the read. One it leaves out is not given to the share.
 */

// compass: variance-authority.retention

import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  cacheRootFor,
  declaredSuites,
  FETCHED_MAINLINE,
  mainlineReadRoot,
  readFetchedMainline,
  testCoverageFile,
} from '@variance-authority/sense/test-selection';
import type { ParsedCarry } from '../carry-args.js';
import { OperatorError, type ExitCode } from '../exit.js';
import { printMoved } from './carry-pushed.js';
import { mainlineBase, mainlineMissed, mainlineRead, readMissedMainline, standOnHanded, writeMissedMainline, type MainlineAsk } from './mainline-base.js';

/** What `hand` writes first, naming the suites it holds a read of. */
const HANDED_MANIFEST = 'handed.json';

export interface BaseHanded {
  /** The suites handed, a record or whatever stopped the read. */
  readonly suites: readonly string[];
  /** The commits the handed records were made at. */
  readonly commits: readonly string[];
  readonly lines: readonly string[];
}

export interface BaseReceived {
  readonly suites: readonly string[];
  readonly lines: readonly string[];
}

/**
 * Read the line for every suite the share carries, write what it answered to
 * `dir`, which holds nothing yet, and lay it here too, so this job stands on the
 * record it hands. The line is always asked: a checkout
 * that kept its cache holds the last run's read, which no later run stands on
 * unless the line gives no answer, and then that kept record is what is handed.
 */
export async function handBase(root: string, dir: string, ask: MainlineAsk = {}): Promise<BaseHanded> {
  const there = await readdir(dir).catch((error: NodeJS.ErrnoException): string[] => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  if (there.length > 0) throw new OperatorError(`variance carry hand writes to an empty directory, and ${dir} holds files`);
  await mkdir(dir, { recursive: true });
  const suites: string[] = [];
  const commits = new Set<string>();
  const lines: string[] = [];
  for (const declared of declaredSuites(root) ?? []) {
    if (declared.carry !== 'share') continue;
    const base = await mainlineBase(root, declared, { ...ask, fetch: 'always' });
    if (base === undefined) continue;
    const to = join(dir, declared.name);
    if ('miss' in base) {
      lines.push(mainlineMissed(base));
      // Handed whatever stopped the read: a shard with a credential this job lacked would read what no other job did.
      await writeMissedMainline(to, {
        ...(base.mainline === undefined ? {} : { mainline: base.mainline }),
        at: new Date().toISOString(),
        miss: base.miss,
        ...(base.holds === undefined ? {} : { holds: base.holds }),
      });
    } else {
      lines.push(mainlineRead(base));
      // A worktree reads its primary checkout's fetch, so the record says where it lies.
      const from = dirname(dirname(base.coverage));
      await mkdir(to, { recursive: true });
      await cp(join(from, FETCHED_MAINLINE), join(to, FETCHED_MAINLINE));
      await cp(join(from, base.commit), join(to, base.commit), { recursive: true });
      commits.add(base.commit);
    }
    suites.push(declared.name);
  }
  await writeFile(join(dir, HANDED_MANIFEST), `${JSON.stringify({ suites })}\n`);
  await receiveBase(root, dir);
  return { suites, commits: [...commits], lines };
}

/** The suites `dir`'s manifest lists, or the refusal: nothing here says what the run read. */
async function handedSuites(dir: string): Promise<readonly string[]> {
  try {
    const { suites } = JSON.parse(await readFile(join(dir, HANDED_MANIFEST), 'utf8')) as { suites?: unknown };
    if (Array.isArray(suites) && suites.every((suite) => typeof suite === 'string')) return suites as readonly string[];
  } catch (error) {
    if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  throw new OperatorError(
    `${dir} holds no ${HANDED_MANIFEST} that reads, so nothing says what this run read: run \`variance carry hand\` once and move its directory here. Stopping rather than ask the line on its own.`,
  );
}

/**
 * Lay the read in `dir` under this checkout's cache, as if this job had made
 * it: every reader here answers with it and asks the line no more, whether it
 * is a record or the line's answer that it gave none. A record of this checkout's
 * own goes once the read stands, since a reader would take it first. A record a
 * reader would pass over refuses here, because passing over it is asking the line.
 */
export async function receiveBase(root: string, dir: string): Promise<BaseReceived> {
  const suites = await handedSuites(dir);
  const cacheRoot = cacheRootFor(root);
  const lines: string[] = [];
  const laid: string[] = [];
  const carried = new Set(declaredSuites(root)?.filter((one) => one.carry === 'share').map((one) => one.name));
  for (const suite of suites) {
    const from = join(dir, suite);
    const pointer = readFetchedMainline(from);
    const missed = readMissedMainline(from);
    if (pointer === undefined && missed === undefined) {
      throw new OperatorError(`${dir} lists "${suite}" and holds nothing of it. Stopping rather than ask the line on its own.`);
    }
    // The job that read may stand on a newer merge than this one, and no reader here asks for a suite this checkout does not carry.
    if (!carried.has(suite)) {
      lines.push(`${suite} is not carried here, so its read is passed over.`);
      continue;
    }
    laid.push(suite);
    const readRoot = mainlineReadRoot(cacheRoot, suite);
    await rm(readRoot, { recursive: true, force: true });
    await cp(from, readRoot, { recursive: true });
    if (pointer !== undefined) {
      await standOnHanded(
        root,
        suite,
        pointer,
        `the record of "${suite}" handed in ${dir}, made at ${pointer.commit}, is missing or this build does not read it. Stopping rather than ask the line on its own.`,
      );
      lines.push(`${suite} stands on the record ${pointer.mainline} published at ${pointer.commit}, as this run read it.`);
    } else if (missed !== undefined) {
      await writeMissedMainline(readRoot, { ...missed, handed: true });
      // The mark a worktree's walk stops at, which no reader takes for a pointer: it names no record.
      await writeFile(join(readRoot, FETCHED_MAINLINE), `${JSON.stringify({ handed: true })}\n`);
      lines.push(`${suite} stands on ${missed.mainline === undefined ? 'no mainline' : `mainline ${missed.mainline}`}'s answer of ${missed.miss.kind}, as this run read it.`);
    }
  }
  // A record a run left on this runner comes before any read, so it would stand
  // instead of this one. It goes last: a read that refused takes nothing with it.
  for (const suite of laid) await rm(dirname(testCoverageFile(root, { suite })), { recursive: true, force: true });
  if (suites.length === 0) lines.push('this run asked no line, so there is no read to stand on.');
  return { suites, lines };
}

/** What a workflow reads of a hand: the commit a pull request's head is merged with. */
export function handedOutputs(handed: BaseHanded): readonly string[] {
  return [`commit=${handed.commits.length === 1 ? handed.commits[0] : ''}`];
}

/**
 * `carry hand|receive <dir>`. Under `--format github` the outputs go to
 * `$GITHUB_OUTPUT` and the lines to the error stream: `commit` is the commit
 * the records were made at, empty when the suites' differ or none was read, and
 * a notice says why when they differ.
 */
export async function moveBase(
  parsed: ParsedCarry,
  root: string,
  streams: { readonly out: (text: string) => void; readonly err: (text: string) => void },
): Promise<ExitCode> {
  const dir = parsed.dir;
  if (dir === undefined) throw new OperatorError(`\`carry ${parsed.direction}\` names the directory the host moves`);
  let outputs: readonly string[];
  let lines: readonly string[];
  if (parsed.direction === 'hand') {
    const handed = await handBase(root, dir);
    outputs = handedOutputs(handed);
    lines = [
      ...handed.lines,
      handed.suites.length === 0 ? 'no suite asked the line, so nothing is handed.' : `handed ${handed.suites.join(', ')} in ${dir}.`,
      ...(parsed.format === 'github' && handed.commits.length > 1
        ? [`::notice::The mainline's records were made at ${handed.commits.join(', ')}, so \`commit\` is empty.`]
        : []),
    ];
  } else {
    const received = await receiveBase(root, dir);
    outputs = [];
    lines = received.lines;
  }
  return printMoved(parsed.format, outputs, lines, streams);
}
