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
 * the line's answer that it gave none. One it leaves out asked no line, and a
 * job that asks finds the same.
 */

// compass: variance-authority.retention

import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  cacheRootFor,
  declaredSuites,
  FETCHED_MAINLINE,
  lastFetchedMainline,
  mainlineReadRoot,
  readFetchedMainline,
  writeFetchedMainline,
} from '@variance-authority/sense/test-selection';
import type { ParsedCarry } from '../carry-args.js';
import { OperatorError, type ExitCode } from '../exit.js';
import { printMoved } from './carry-pushed.js';
import { mainlineBase, mainlineMissed, mainlineRead, readMissedMainline, writeMissedMainline, type MainlineAsk } from './mainline-base.js';

/** What `hand` writes first, naming the suites it holds a read of. */
export const HANDED_MANIFEST = 'handed.json';

export interface BaseHanded {
  /** The suites a read was handed for, the line's answer that it gave none among them. */
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
 * `dir`, replacing what was there, and lay it here too, so this job stands on
 * the record it hands. The line is always asked: a checkout that kept its cache
 * holds the last run's read, which no later run stands on.
 */
export async function handBase(root: string, dir: string, ask: MainlineAsk = {}): Promise<BaseHanded> {
  await rm(dir, { recursive: true, force: true });
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
      if (base.mainline === undefined || base.miss.kind === 'unconfigured') continue;
      await writeMissedMainline(to, {
        mainline: base.mainline,
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
 * is a record or the line's answer that it gave none. A record a reader would
 * pass over refuses here, because passing over it is asking the line.
 */
export async function receiveBase(root: string, dir: string): Promise<BaseReceived> {
  const suites = await handedSuites(dir);
  const cacheRoot = cacheRootFor(root);
  const lines: string[] = [];
  for (const suite of suites) {
    const from = join(dir, suite);
    const pointer = readFetchedMainline(from);
    const missed = readMissedMainline(from);
    if (pointer === undefined && missed === undefined) {
      throw new OperatorError(`${dir} lists "${suite}" and holds nothing of it. Stopping rather than ask the line on its own.`);
    }
    const readRoot = mainlineReadRoot(cacheRoot, suite);
    await rm(readRoot, { recursive: true, force: true });
    await cp(from, readRoot, { recursive: true });
    if (pointer !== undefined) {
      await writeFetchedMainline(cacheRoot, suite, { ...pointer, handed: true });
      if (lastFetchedMainline(root, suite, cacheRoot, pointer.mainline)?.commit !== pointer.commit) {
        throw new OperatorError(
          `the record of "${suite}" handed in ${dir}, made at ${pointer.commit}, is missing or this build does not read it. Stopping rather than ask the line on its own.`,
        );
      }
      lines.push(`${suite} stands on the record ${pointer.mainline} published at ${pointer.commit}, as this run read it.`);
    } else if (missed !== undefined) {
      await writeMissedMainline(readRoot, { ...missed, handed: true });
      lines.push(`${suite} stands on mainline ${missed.mainline}'s answer of ${missed.miss.kind}, as this run read it.`);
    }
  }
  if (suites.length === 0) lines.push('this run asked no line, so there is no read to stand on.');
  return { suites, lines };
}

/** What a workflow reads of a hand: the commit a pull request's head is merged with, and the suites handed. */
export function handedOutputs(handed: BaseHanded): readonly string[] {
  return [`commit=${handed.commits.length === 1 ? handed.commits[0] : ''}`, `handed=${handed.suites.join(' ')}`];
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
        ? [`::notice::The mainline's records were made at ${handed.commits.join(', ')}, so a pull request's head stays merged with the base tip.`]
        : []),
    ];
  } else {
    const received = await receiveBase(root, dir);
    outputs = [`received=${received.suites.join(' ')}`];
    lines = received.lines;
  }
  return printMoved(parsed.format, outputs, lines, streams);
}
