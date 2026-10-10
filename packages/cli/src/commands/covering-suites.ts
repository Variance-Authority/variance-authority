// compass: variance-authority.reach

/**
 * `variance covering` asked of every suite the root config declares.
 *
 * A suite is a role, not a runner: one Playwright install can be the visual
 * suite under one config and the end-to-end suite under another, and each
 * proves something different. Each records on its own because each runs on its
 * own, so a question about a line is asked of every record and the answer says
 * which suite, of which kind, went through it. Folding the records into one
 * answer would drop exactly that, and it is what an editor shows: which slice
 * of confidence saw this code, and which never loaded it.
 *
 * Every suite keeps its own frame, because each was recorded over its own
 * text: the suite run an hour ago can be stale where the one run a minute ago
 * is not, and one stale record must not blank the others.
 */

import {
  declaredSuites,
  testCoverageFile,
  type DeclaredSuite,
  type SuiteKind,
} from '@variance-authority/sense/test-selection';
import type { ParsedCovering } from '../covering-args.js';
import { OperatorError, type RefusalKind } from '../exit.js';
import { heldText } from './covering-frame.js';
import { covering, formatCovering, type Covering, type CoveringFormat } from './covering.js';
import { UnloadedFile } from './covering-unloaded.js';
import { asOperator, nothingRecorded } from './suite-record.js';

/** One suite's answer, or why its record could not give one. */
export type SuiteAnswer =
  | (Covering & { readonly suite: string; readonly kind: SuiteKind })
  | {
      readonly suite: string;
      readonly kind: SuiteKind;
      /** Present when a program can act on the refusal: `unrecorded`, or `unloaded` for a file the suite never loaded. */
      readonly refused?: RefusalKind;
      /** With `unloaded`, when the record holds the file's name under another path: the spellings it holds. */
      readonly spelled?: readonly string[];
      readonly reason: string;
    };

/** The question asked of every declared suite, in declaration order. */
export interface CoveringSuites {
  readonly file?: string;
  readonly since?: string;
  readonly suites: readonly SuiteAnswer[];
}

/**
 * Answer from the record the question names, or from every declared suite's.
 *
 * `--execution` and `--suite` each name one record, and a repository that
 * declares no suites has one; all three answer as `covering` always has. Only
 * a repository that declares suites and a question that names none is read
 * suite by suite.
 */
export async function coveringAnswer(request: ParsedCovering): Promise<Covering | CoveringSuites> {
  if (request.execution !== undefined) return covering(request);
  const declared = asOperator(() => declaredSuites(request.root));
  if (request.suite !== undefined || declared === undefined) {
    // Checked here, where the refusal is the operator's: a name the root
    // config does not declare says so rather than failing as a missing file.
    asOperator(() => testCoverageFile(request.root, { suite: request.suite }));
    return covering(request);
  }

  // Standard input is read once, and every suite places its ranges in that text.
  const asked: ParsedCovering = request.since === undefined && request.text !== undefined
    ? { ...request, held: (await heldText(request)) ?? '' }
    : request;
  const suites: SuiteAnswer[] = [];
  for (const one of declared) suites.push(await askSuite(asked, one));
  if (suites.every((answer) => 'refused' in answer && answer.refused === 'unrecorded')) {
    throw nothingRecorded(request.root, declared.map((one) => one.name));
  }

  return {
    ...(request.file === undefined ? {} : { file: request.file }),
    ...(request.since === undefined ? {} : { since: request.since }),
    suites,
  };
}

async function askSuite(request: ParsedCovering, suite: DeclaredSuite): Promise<SuiteAnswer> {
  const named = { suite: suite.name, kind: suite.kind };
  try {
    return { ...named, ...(await covering({ ...request, suite: suite.name })) };
  } catch (error) {
    if (!(error instanceof OperatorError)) throw error;
    return {
      ...named,
      ...(error.kind === undefined ? {} : { refused: error.kind }),
      ...(error instanceof UnloadedFile && error.spelled.length > 0 ? { spelled: error.spelled } : {}),
      reason: error.message,
    };
  }
}

/**
 * Say either answer in the shape the caller asked for.
 *
 * Once any suite said something about the file, the answers come first. A suite
 * that has never run follows them, and one that never loaded the file is named
 * on the closing line without its record's path or size: the reader came for
 * the answer, and a suite that tests other code is the common case, not a
 * finding. A suite whose record holds the file's name under another path keeps
 * its refusal whole among the answers, since that is a finding about the
 * recording. When none loaded it, each suite's refusal is the answer, and is
 * printed in full with the spelling it points at. JSON carries every refusal
 * whole either way.
 */
export function formatCoveringAnswer(answer: Covering | CoveringSuites, format: CoveringFormat): string {
  if (!('suites' in answer)) return formatCovering(answer, format);
  if (format === 'json') return `${JSON.stringify(answer, undefined, 2)}\n`;

  const named = (one: SuiteAnswer): string => `${one.suite} (${one.kind})`;
  const say = (one: SuiteAnswer): string => {
    const head = `${named(one)}:`;
    if ('reason' in one) return `${head} ${one.reason}\n`;
    const body = formatCovering(one, format);
    return `${head}\n${format === 'refs' ? body : body.replace(/^(?=.)/gmu, '  ')}`;
  };
  // Any other refusal, about a line, a function or a `--where` the suite holds,
  // is an answer about the file, and so is a record that spells it another way;
  // never loading it, or never running, is not.
  const answered: SuiteAnswer[] = [];
  const unrecorded: SuiteAnswer[] = [];
  const away: SuiteAnswer[] = [];
  for (const one of answer.suites) {
    if (!('reason' in one)) answered.push(one);
    else if (one.refused === 'unrecorded') unrecorded.push(one);
    else if (one.refused === 'unloaded' && one.spelled === undefined) away.push(one);
    else answered.push(one);
  }
  if (answered.length === 0) return answer.suites.map(say).join('\n');

  const said = [...answered, ...unrecorded].map(say);
  if (away.length > 0) {
    said.push(
      `Not loaded by ${away.map(named).join(', ')}: a run that never loaded the file has no answer about it, ` +
        'which is not the same as no test covering it.\n',
    );
  }
  return said.join('\n');
}
