/**
 * The runs record as `coverage.runs.json` holds it (`commit-runs.ts`): the text
 * a run writes, and what any build's text is read as. It is JSON a run wrote,
 * read without its writer's types, so it is read by its fields, never trusted.
 */

// compass: variance-authority.reach

import type { CommitRuns } from './commit-runs.js';
import { keptInstallOf } from './kept-install.js';
import { keptTextsOf } from './kept-texts.js';
import { whatLanded, type Landing } from './landings.js';

type Fields = { readonly [field: string]: unknown };

const fieldsOf = (value: unknown): value is Fields => typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * The runs record `text` holds, as this build writes it, or a throw that starts
 * with `named`: it is JSON a run wrote, read without its writer's types, so a
 * shape it does not have is refused by name, never met as a `TypeError` by the
 * reader that trusted it. A record written before landings reads as one
 * landing. So does one whose landings stand beside a list of files that is not
 * the one written with them (`commitRunsText`): a build that keeps no landings
 * rewrote the list and carried the landings unread, so it wrote the record. The
 * list is read for nothing else, and an install stored beside the landings is
 * not read: the landings say both (`whatLanded`).
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
  if (kept !== undefined && !Array.isArray(kept)) throw new Error(`${named} holds \`landings\` that is not a list`);
  const finished = (landings: readonly unknown[]): landings is readonly Landing[] =>
    landings.every((landing) => fieldsOf(landing) && Array.isArray(landing.files));
  if (kept !== undefined && !finished(kept)) throw new Error(`${named} holds a landing with no list of the test files it finished`);
  let landings: readonly unknown[];
  if (kept !== undefined && (!Array.isArray(files) || listsLanded(files, kept))) {
    landings = kept;
  } else if (!Array.isArray(files)) {
    throw new Error(`${named} has no list of the test files that ran at its commit`);
  } else {
    // Written before landings, or rewritten by a build that keeps none: one
    // landing of the files it listed, with its span and install. One of no runs
    // was a seed, stamped when it was seeded, so its time is not held; it names
    // no texts, which came after it.
    const ran = typeof parsed.runs === 'number' && parsed.runs > 0;
    landings = files.length === 0 ? [] : [{
      files,
      ...(ran && parsed.first !== undefined ? { first: parsed.first } : {}),
      ...(ran ? { latest: parsed.latest, runs: parsed.runs } : {}),
      ...(parsed.installed === undefined ? {} : { installed: parsed.installed }),
    }];
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

/** Whether `files` lists what `landings` finished, as `commitRunsText` wrote it beside them. */
function listsLanded(files: readonly unknown[], landings: readonly Landing[]): boolean {
  const landed = new Set<unknown>(whatLanded(landings).files);
  const listed = new Set(files);
  return listed.size === landed.size && [...listed].every((file) => landed.has(file));
}

/**
 * The text of `record` as a run writes it. Beside its landings it lists the
 * files they finished (`whatLanded`) as `files`, which a build that keeps no
 * landings reads as the files that ran at the record's commit and fails
 * without. A file its landings ran only in part is not among them, so such a
 * build places it where `standing` does. `commitRunsIn` reads the list only to
 * know whether the landings are still the ones written with it.
 */
export function commitRunsText(record: CommitRuns): string {
  return `${JSON.stringify({ ...record, files: whatLanded(record.landings).files }, null, 2)}\n`;
}
