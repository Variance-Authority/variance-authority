// compass: variance-authority.reach.crossings
/**
 * `coverage --session`: runs a person made on their own machine, set beside
 * the record function by function.
 *
 * A session is V8 coverage somebody exported — Playwright's, CDP's or a
 * `NODE_V8_COVERAGE` directory — and is read as evidence beside the record,
 * never into it: no session becomes a case, so selection and shards answer as
 * they did. The record decides the cut: each session is walked under the mode
 * the records were cut in, and a function is named in the checkout's text. The
 * answer's point is the list of functions some session ran and no recorded case
 * entered, by file and with the sessions that ran each.
 */

import { readFileSync, realpathSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { checkoutPath } from '@variance-authority/sense/checkout-path';
import { instrumentModeOf, type WalkMode } from '@variance-authority/sense/instrument';
import { readTestCoverage, sessionsAgainst, sessionSources, type CoverageModule, type NamedSession, type SessionsFile, type SessionSource, type SourceRead } from '@variance-authority/sense/test-selection';
import { OperatorError } from '../exit.js';
import { readSession } from './session-input.js';

/** A function some session ran that no recorded case entered. */
export interface UntestedFunction {
  readonly name: string;
  readonly startLine?: number;
  readonly endLine?: number;
  /** The sessions that ran it, by name. */
  readonly sessions: readonly string[];
}

export interface CoverageSessions {
  /** The sessions, in the order given. */
  readonly names: readonly string[];
  /** Per session, in order, what it ran that no function is named from. */
  readonly each: readonly SessionDropped[];
  /** Per file, the functions some session ran and no recorded case entered. */
  readonly untested: readonly { readonly file: string; readonly functions: readonly UntestedFunction[] }[];
  /** Functions some session ran that no case can be counted for: the record holds them in another text, or loaded their file unprobed. */
  readonly uncounted: number;
  /** Every function of every file a session loaded, with each session's verdict and the test files that entered it. */
  readonly files: readonly SessionsFile[];
  /** Files a record holds that no session loaded. */
  readonly notLoaded: readonly string[];
  /** Files some session loaded whose text in the checkout could not be cut. */
  readonly uncut: readonly string[];
}

/** One session's sources that no function is named from, each list by why. */
export interface SessionDropped {
  readonly name: string;
  /** Scripts it could not place as a file on this machine, or whose text or map could not be read. */
  readonly skipped: readonly string[];
  /** Sources its maps name that no file on this machine answers. */
  readonly unplaced: readonly string[];
  /** Sources placed and read whose text, as the session ran it, could not be cut. */
  readonly uncut: readonly string[];
  /** Sources outside the checkout, or in a dependency under `node_modules`: no record holds them. */
  readonly outside: readonly string[];
  /** Sources its maps hold no text of, written since the script that ran them was built. */
  readonly stale: readonly string[];
  /** Functions it ran that the checkout no longer holds, each as `<name> in <file>`. */
  readonly gone: readonly string[];
}

/** `sessions`, set beside the records at `records`, with every file read from `root`. */
export async function coverageSessions(
  root: string,
  sessions: readonly { readonly name: string; readonly path: string }[],
  served: string | undefined,
  records: readonly string[],
): Promise<CoverageSessions> {
  const suites = await Promise.all(records.map(readTestCoverage));
  const mode = walkModeOf(suites.map((suite) => suite.instrumentation));
  const readSource = (file: string): SourceRead | undefined => {
    const at = isAbsolute(file) ? file : join(root, file);
    try {
      return { text: readFileSync(at, 'utf8'), modifiedAt: statSync(at).mtimeMs };
    } catch {
      return undefined;
    }
  };
  const read = (file: string): string | undefined => readSource(file)?.text;
  // Node names a script by its real path, which on macOS sits under `/private`.
  const roots = [...new Set([root, realpathSync(root)])];
  const named: NamedSession[] = [];
  const each: SessionDropped[] = [];
  for (const session of sessions) {
    const input = await readSession(session.path, served);
    const walked = sessionSources(input.scripts, mode, readSource);
    const own: SessionSource[] = [];
    const outside = new Set<string>();
    for (const source of walked.sources) {
      const file = ownFile(roots, source.file);
      if (file === undefined) outside.add(source.file);
      else own.push({ ...source, file });
    }
    named.push({ name: session.name, sources: own });
    each.push({ name: session.name, skipped: input.skipped, unplaced: walked.unplaced, uncut: walked.uncut, outside: [...outside].sort(codeUnitOrder), stale: walked.stale, gone: [] });
  }
  const answer = sessionsAgainst(named, suites.map((suite): readonly CoverageModule[] => suite.modules), read, mode);
  const withGone = each.map((dropped) => ({
    ...dropped,
    gone: answer.files.flatMap(({ file, gone }) => gone.filter((ran) => ran.sessions.includes(dropped.name)).map((ran) => `${ran.name} in ${file}`)),
  }));
  const names = sessions.map((session) => session.name);
  const untested = answer.files.flatMap(({ file, functions }) => {
    const ran = functions.filter((each) => each.testFiles?.length === 0 && each.sessions.includes('ran')).map((each): UntestedFunction => ({
      name: each.name,
      ...(each.row.startLine === undefined ? {} : { startLine: each.row.startLine, endLine: each.row.endLine }),
      sessions: names.filter((_, at) => each.sessions[at] === 'ran'),
    }));
    return ran.length === 0 ? [] : [{ file, functions: ran }];
  });
  const uncounted = answer.files.flatMap((file) => file.functions).filter((each) => each.testFiles === undefined && each.sessions.includes('ran')).length;
  return { names, each: withGone, untested, uncounted, files: answer.files, notLoaded: answer.notLoaded, uncut: answer.uncut };
}

/** The one mode every record was cut in: a session is walked as the records were, or the two would name different regions. */
function walkModeOf(instrumentations: readonly string[]): WalkMode {
  const modes = new Set(instrumentations.map((each) => instrumentModeOf(each)));
  if (modes.size !== 1) throw new OperatorError('`--session` needs records cut in one instrumentation mode, and these were cut in several; count one `--suite` at a time.');
  const [mode] = modes;
  if (mode === undefined || mode === 'loads') {
    throw new OperatorError(`\`--session\` names functions, and this record was ${mode === 'loads' ? 'cut by module loads alone' : `made by \`${instrumentations[0]}\``}; record with presence or entries instrumentation first.`);
  }
  return mode;
}

/** `file` spelled from the root, as a record spells it; `undefined` for a file outside the root or a dependency's. */
function ownFile(roots: readonly string[], file: string): string | undefined {
  for (const root of roots) {
    const spelled = checkoutPath(root, file);
    if (!('path' in spelled)) continue;
    return spelled.path.split('/').includes('node_modules') ? undefined : spelled.path;
  }
  return undefined;
}
