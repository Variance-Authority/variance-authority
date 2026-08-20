import { readFile } from 'node:fs/promises';
import {
  adjudicateRun,
  describeAdjudication,
  type Claim,
  type RunAdjudication,
  type RunReport,
} from '@variance-authority/report';
import { EXIT_CLEAN, EXIT_REVIEW, OperatorError, type ExitCode } from '../exit.js';

/**
 * `variance adjudicate` — the run, read back against what the author declared.
 *
 * The command that exists because a report cannot contain the one thing a review
 * most needs. A run knows what moved; it does not know what anybody *meant* to
 * move, and without that half it can only ever say "23 subjects changed" and hand
 * the sorting to a person. The declaration is the missing input, and it has to
 * arrive from outside the run.
 *
 * ## Why a file and not a flag
 *
 * `--intent "tighten the card"` is a sentence, and a sentence cannot be matched
 * against anything. A claim is a root, a reason and a bound, several of them per
 * branch, and the shape of that is a file. `variance run --intent` keeps doing
 * what it always did — carrying the author's words into the report so every
 * surface can print them — and this reads the structured declaration beside it.
 *
 * ## Why it is a separate command
 *
 * Declaration is not a property of a run, it is a property of a *change*. The same
 * report is adjudicated differently by the agent that wrote the branch, which
 * knows what it edited, and by a reviewer who does not. Folding the claims into
 * `variance run` would make the run's exit code depend on who was asking, and
 * make an unread declaration silently authorize whatever it happened to match.
 */

export interface AdjudicateInput {
  readonly report: RunReport;
  readonly claims: readonly Claim[];
}

export function adjudicateReport(input: AdjudicateInput): RunAdjudication {
  return adjudicateRun(input.report, input.claims);
}

export function formatAdjudication(result: RunAdjudication): string {
  return `${describeAdjudication(result)}\n`;
}

/**
 * `unmet` is a review, not an operator error.
 *
 * A claim that did not land is a fact about the branch, not about the tool: the
 * command did exactly what it was asked and the answer is bad news. `2` is
 * reserved for *this ran wrong*, and spending it here would make a failed edit
 * indistinguishable from a missing config file to anything reading the code.
 */
export function exitForAdjudication(result: RunAdjudication): ExitCode {
  return result.verdict === 'clean' ? EXIT_CLEAN : EXIT_REVIEW;
}

/**
 * Read a declaration off disk.
 *
 * Accepts `{"claims": [...]}` or a bare array, because both are what somebody
 * writes on the first try. Everything else is refused with the shape spelled out:
 * a declaration this cannot parse must never degrade into an empty one, which
 * would adjudicate the run against nothing and report that nothing was missing.
 */
export async function readClaims(path: string): Promise<readonly Claim[]> {
  const text = await readFile(path, 'utf8').catch((error: unknown) => {
    throw new OperatorError(
      `could not read the claims file \`${path}\`: ${message(error)}. It holds what you meant ` +
        'to change, and there is no default for that.',
    );
  });

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new OperatorError(`\`${path}\` is not readable JSON: ${message(error)}`);
  }

  const entries = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed['claims'])
      ? parsed['claims']
      : undefined;

  if (entries === undefined) {
    throw new OperatorError(
      `\`${path}\` must hold a JSON array of claims, or an object with a \`claims\` array. ` +
        'Each claim is {"root": "component:Button", "reason": "why", "maxSubjects": 3}.',
    );
  }

  if (entries.length === 0) {
    // An empty declaration and no declaration are the same state, and neither is
    // a clean run. Refused here rather than adjudicated, because "0 claims, 0
    // undelivered" reads as reassurance to whoever skims it.
    throw new OperatorError(
      `\`${path}\` declares no claims. An empty declaration cannot be contradicted by anything, ` +
        'so adjudicating against it would report that every edit landed without checking one.',
    );
  }

  return entries.map((entry, index) => claimOf(entry, index, path));
}

function claimOf(entry: unknown, index: number, path: string): Claim {
  const at = `${path} claim ${index + 1}`;

  if (!isRecord(entry)) throw new OperatorError(`${at} must be an object`);

  const root = entry['root'];
  const reason = entry['reason'];
  const maxSubjects = entry['maxSubjects'];

  if (typeof root !== 'string' || root === '') {
    throw new OperatorError(
      `${at} needs a \`root\`: \`component:Button\`, \`shape:<fingerprint>\`, or a bare ` +
        'component name',
    );
  }
  if (typeof reason !== 'string' || reason === '') {
    // Required rather than optional, and the reason is the audience. The answer
    // is read by whoever picks the branch up next, and `component:Button —
    // declared` tells them nothing a diff would not have.
    throw new OperatorError(
      `${at} needs a \`reason\`: why you changed it, in your own words. It is carried into ` +
        'the answer, which is read by whoever reviews the branch.',
    );
  }
  if (maxSubjects !== undefined && (typeof maxSubjects !== 'number' || maxSubjects < 1)) {
    throw new OperatorError(`${at} has a \`maxSubjects\` that is not a positive number`);
  }

  return maxSubjects === undefined
    ? { root, reason }
    : { root, reason, maxSubjects: Math.trunc(maxSubjects) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
