import { readChangelog, wasRead, type ChangelogCommit } from '@variance-authority/store';
import type { ChangelogEntry } from '@variance-authority/report';
import type { Config } from '../config.js';
import { OperatorError } from '../exit.js';

/**
 * `variance changelog` — why the baselines look the way they do.
 *
 * The run says what changed *today*. This says what was accepted, by whom, under
 * which run, over the last however-many commits — which is the question somebody
 * actually asks, and they ask it about a baseline they did not approve and cannot
 * remember. Where baselines are files in this repository the answer is already
 * here: `accept` wrote it into the commit message, and this reads it back out.
 *
 * ## What it will not do
 *
 * It will not answer for a store whose baselines are not commits. Under
 * `ephemeral` retention there is no baseline to explain; under a `remote` store
 * the baselines live behind an endpoint and the explanation went to that
 * service's record rather than to this checkout's log. Both refuse **by name**
 * rather than printing an empty history, because an operator who reads "no
 * baseline updates" about a project that updates baselines weekly will go looking
 * for a bug in the writer, and the bug is that they asked the wrong store.
 *
 * ## Filters narrow, they never explain
 *
 * `--component` and `--subject` select from what was read. A commit that carried
 * a record but nothing matching is dropped, and a reading that ends up empty
 * still prints whatever bounded it — so "no results" and "could not see" stay
 * apart on the way out, exactly as they are on the way in.
 */

export interface ChangelogViewOptions {
  /** Only entries whose component matches, case-insensitively, as a substring. */
  readonly component?: string;
  /** Only entries that promoted this subject. Exact, because a subject id is exact. */
  readonly subject?: string;
}

/**
 * The baseline root to read the log of, or a refusal naming the store.
 *
 * Refused here rather than in `readChangelog`, because "this backend does not
 * keep its explanations in commits" is a fact about how this project is
 * configured, and the reader is a thing that runs `git log`.
 */
export function changelogRootFor(config: Config): string {
  if (config.retention === 'ephemeral') {
    throw new OperatorError(
      'this project keeps no baselines (`retention: "ephemeral"`), so no baseline was ever ' +
        'updated and there is nothing to explain. A changelog is a record of promotions, and ' +
        'an ephemeral run compares against what it just rendered',
    );
  }

  const baselines = config.baselines;
  if (baselines === undefined) {
    throw new OperatorError('`durable` retention needs a `baselines` store, and none is set');
  }

  if (baselines.kind === 'remote') {
    throw new OperatorError(
      `baselines for this project live at ${baselines.endpoint}, not in this repository, so ` +
        'their explanations were recorded by that service rather than in a commit here. Ask it ' +
        'for the history; this command reads the log of a checkout',
    );
  }

  return baselines.root;
}

/**
 * Read the repository's account of its own baselines.
 *
 * Thin on purpose: the reading is `store`'s, the refusal above is the config's,
 * and what is left here is turning a store-level `Unreadable` into the tool's own
 * operator error so a missing `git` exits 2 with a sentence rather than 0 with an
 * empty list.
 */
export async function changelog(options: {
  readonly config: Config;
  readonly limit?: number;
  readonly since?: string;
}): Promise<{ readonly commits: readonly ChangelogCommit[]; readonly bounded: readonly string[] }> {
  const root = changelogRootFor(options.config);
  const answer = await readChangelog({
    root,
    cwd: process.cwd(),
    ...(options.limit !== undefined ? { limit: options.limit } : {}),
    ...(options.since !== undefined ? { since: options.since } : {}),
  });

  if (!wasRead(answer)) throw new OperatorError(answer.because);
  return answer;
}

/** Whether an entry survives the operator's filters. */
function matches(entry: ChangelogEntry, view: ChangelogViewOptions): boolean {
  if (
    view.component !== undefined &&
    !(entry.component ?? '').toLowerCase().includes(view.component.toLowerCase())
  ) {
    return false;
  }
  if (view.subject !== undefined && !entry.subjects.includes(view.subject)) return false;
  return true;
}

/**
 * The history, as the operator reads it.
 *
 * Newest first, one block per commit, and every block says the four things that
 * make a promotion accountable: which run proposed it, how the subjects were
 * selected, what was promoted, and — where the run knew it — what the change was
 * for. The selection is in the header line rather than folded into a sentence,
 * because `--all` and a named subject are different amounts of review and a
 * reader auditing a baseline needs to see which one they are looking at.
 *
 * The same columns as the commit message, in the same order, because they are the
 * same record: somebody who has read one `git log` entry should not have to learn
 * a second layout to read fifty of them. What differs is what only a reader can
 * add — the commit each record came from, and what bounded the reading.
 *
 * A shortfall gets its own indented line instead of a column. `3/4` is enough
 * when you are scrolling past one commit in a log; when you have gone looking for
 * this shape on purpose, the sentence is the answer you came for.
 */
export function formatChangelog(
  result: { readonly commits: readonly ChangelogCommit[]; readonly bounded: readonly string[] },
  view: ChangelogViewOptions = {},
): string {
  const blocks: string[] = [];

  for (const commit of result.commits) {
    const entries = commit.record.entries.filter((entry) => matches(entry, view));
    if (entries.length === 0 && (view.component !== undefined || view.subject !== undefined)) {
      continue;
    }

    const lines = [
      `${commit.sha.slice(0, 12)}  ${commit.at}  run ${commit.record.run} @ ` +
        `${commit.record.commit.slice(0, 12)} --${commit.record.selection}` +
        (commit.record.by === undefined ? '' : ` ${commit.record.by}`),
      ...(commit.record.intent === undefined ? [] : [`  ${commit.record.intent}`]),
      ...entries.map((entry) => `  ${describe(entry)}`),
      // A shape promoted in some of the subjects it reached is the one line that
      // must not be summarised away: the rest of that shape is still a difference
      // somebody will meet in a later run, and this is where it was decided.
      ...entries
        .filter((entry) => entry.reached > entry.subjects.length)
        .map(
          (entry) =>
            `    (${String(entry.subjects.length)} of ${String(entry.reached)} subject(s) this ` +
            'shape reached were promoted here)',
        ),
      ...(commit.record.ungrouped === 0
        ? []
        : [
            `  ${String(commit.record.ungrouped)} accepted subject(s) no shape could group; ` +
              'the commit itself is their explanation',
          ]),
      // Phrased here rather than stored: the record carries the token and the two
      // values, so this sentence can be rewritten in any release without going
      // back to rewrite history.
      ...(commit.record.drift ?? []).map(
        (drift) =>
          `  drift: ${drift.token} ${drift.from} -> ${drift.to} across ` +
          `${String(drift.steps)} approved change(s); no single review saw the total`,
      ),
    ];
    blocks.push(lines.join('\n'));
  }

  if (blocks.length === 0) {
    blocks.push(
      view.component === undefined && view.subject === undefined
        ? 'no commit under the baseline root carries a record of what it promoted'
        : 'no recorded baseline update matches that filter',
    );
  }

  // Printed last and always, including when there were results: what bounded a
  // reading is the difference between "this is the history" and "this is what
  // could be seen from here", and only the second is ever true in CI.
  return [...blocks, ...result.bounded.map((sentence) => `note: ${sentence}`)].join('\n\n');
}

/** One promoted shape, on one line, in the commit message's columns. */
function describe(entry: ChangelogEntry): string {
  const where = [entry.component, entry.file].filter((part) => part !== undefined).join(' ');
  const subjects =
    entry.reached > entry.subjects.length
      ? `${String(entry.subjects.length)}/${String(entry.reached)}`
      : String(entry.subjects.length);

  return (
    `${entry.fingerprint} ${where === '' ? 'unattributed' : where} ${subjects}` +
    (entry.cause ? '' : ' collateral')
  );
}
