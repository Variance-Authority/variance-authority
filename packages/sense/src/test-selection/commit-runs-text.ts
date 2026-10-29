/**
 * The runs record as `coverage.runs.json` holds it (`commit-runs.ts`): the text
 * a run writes, and what any build's text is read as. It is JSON a run wrote,
 * read without its writer's types, so it is read by its fields, never trusted.
 */

// compass: variance-authority.reach

import type { CommitRuns } from './commit-runs.js';
import { keptInstallOf } from './kept-install.js';
import { keptTextsOf } from './kept-texts.js';

type Fields = { readonly [field: string]: unknown };

const fieldsOf = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The runs record `text` holds, as this build writes it, or a throw that starts
 * with `named`: it is JSON a run wrote, read without its writer's types, so a
 * shape it does not have is refused by name, never met as a `TypeError` by the
 * reader that trusted it. A record written before landings reads as one
 * landing, and a list of files or an install stored beside the landings is not
 * read: the landings say both (`whatLanded`).
 */
export function commitRunsIn(text: string, named: string): CommitRuns {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new Error(`${named} is not JSON: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  if (!fieldsOf(parsed)) throw new Error(`${named} is not a JSON object`);
  const { standing, landings: kept, files } = parsed;
  if (standing !== undefined && !Array.isArray(standing)) throw new Error(`${named} holds a \`standing\` that is not a list`);
  const stands: readonly unknown[] = standing ?? [];
  for (const entry of stands) {
    if (!fieldsOf(entry) || !Array.isArray(entry.files)) throw new Error(`${named} holds a \`standing\` entry with no list of test files`);
    if (typeof entry.commit !== 'string') throw new Error(`${named} holds a \`standing\` entry that names no commit`);
  }
  let landings: readonly unknown[];
  if (kept !== undefined) {
    if (!Array.isArray(kept)) throw new Error(`${named} holds \`landings\` that is not a list`);
    landings = kept;
  } else if (!Array.isArray(files)) {
    throw new Error(`${named} has no list of the test files that ran at its commit`);
  } else {
    // Written before landings: one landing of the files it listed, with its span
    // and install. One of no runs was a seed, stamped when it was seeded, so its
    // time is not held; it names no texts, which came after it.
    landings = files.length === 0 ? [] : [{
      files,
      ...(typeof parsed.runs === 'number' && parsed.runs > 0 ? { first: parsed.first, latest: parsed.latest, runs: parsed.runs } : {}),
      ...(parsed.installed === undefined ? {} : { installed: parsed.installed }),
    }];
  }
  if (!landings.every((landing) => fieldsOf(landing) && Array.isArray(landing.files))) {
    throw new Error(`${named} holds a landing with no list of the test files it finished`);
  }
  // An install or texts that are not one are left out, where they stand and on
  // a landing: an install not known compares from the record's commit, which
  // runs more and skips nothing, and texts not known say so.
  const known = (of: Fields): Fields => {
    const { installed, texts, ...rest } = of;
    const install = keptInstallOf(installed);
    const ranOver = keptTextsOf(texts);
    return { ...rest, ...(install === undefined ? {} : { installed: install }), ...(ranOver === undefined ? {} : { texts: ranOver }) };
  };
  return {
    ...(parsed.commit === undefined ? {} : { commit: parsed.commit }),
    ...(parsed.over === undefined ? {} : { over: parsed.over }),
    latest: parsed.latest,
    runs: parsed.runs,
    ...(standing === undefined ? {} : { standing: (stands as Fields[]).map(known) }),
    landings: (landings as Fields[]).map(known),
  } as unknown as CommitRuns;
}
