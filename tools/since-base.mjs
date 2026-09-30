/**
 * Where the change `test:since` reads starts, which is not always the commit the
 * snapshot names.
 *
 * A snapshot names the commit of the latest run laid into it, not the commit
 * every observation in it was made at. A leg of `--at-distance` is a run: the
 * seam lands it and stamps the snapshot at `HEAD`, and every test the leg did
 * not run still stands on the text of the commit the snapshot named before.
 * Read from the snapshot's commit alone, the next leg finds nothing changed and
 * runs nothing — which is the far half of the loop, skipped. `landRun` already
 * wrote down where the snapshot stood before the runs at this commit, in
 * `coverage.runs.json`, and `variance review` reads the same field for the same
 * question; so it is read here too, rather than worked out again or ignored.
 *
 * A ref on the command line names the start instead: the merge base with it,
 * which is what `yarn test:since main` has always said it measures from.
 *
 * What changed between that start and the snapshot's commit is charged whole,
 * file by file, and left out of the hunk diff. The rows are in the snapshot
 * commit's line numbers, and the tests the leg did not run executed the older
 * text: no hunk between the two is in coordinates both sides share, and a
 * both-texts reading of the snapshot commit against the tree would judge the
 * wrong pair of texts and could call the edit inert. Whole files select more
 * inside them and never skip.
 */

/** The non-empty lines of one git answer. */
export const lines = (text) =>
  text
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '');

/** Whether `ancestor` is in the history of `commit`, asked of git. */
function isAncestor(git, ancestor, commit) {
  try {
    git('merge-base', '--is-ancestor', ancestor, commit);
    return true;
  } catch {
    return false;
  }
}

/** The start the runs at this commit recorded, when they are the snapshot's own runs. */
function fromRuns(commit, runs) {
  if (runs?.commit !== commit || runs.over === undefined || runs.over === commit) return undefined;
  return { from: runs.over, says: `where the snapshot stood before the runs at ${commit.slice(0, 12)}` };
}

/**
 * The reading `test:since` makes: the commit the hunk diff and the recorded
 * text are read from (`base`), the commit the change starts at (`from`), the
 * files changed between the two that are charged whole, and the words the
 * header prints after `from`.
 *
 * `runs` is `coverage.runs.json` of the layer being read, and only of this
 * checkout's own layer: a worktree reading the primary checkout's record would
 * be handed the primary's change. `widened` is set when the start is named and
 * git cannot read it — a start rewritten away by a rebase and collected — and
 * the caller runs the whole suite rather than narrowing on half a change.
 */
export function readingFrom({ commit, ref, runs, git }) {
  if (commit === undefined) {
    const merged = git('merge-base', ref, 'HEAD').trim();
    return { base: merged, from: merged, whole: [], says: `the merge base with ${ref}` };
  }
  let start;
  if (ref === undefined) start = fromRuns(commit, runs);
  else {
    const merged = git('merge-base', ref, 'HEAD').trim();
    if (merged !== commit && isAncestor(git, merged, commit)) start = { from: merged, says: `the merge base with ${ref}` };
    else if (merged !== commit) {
      return { base: commit, from: commit, whole: [], says: `where the snapshot was recorded; the merge base with ${ref} is not before it` };
    }
  }
  if (start === undefined) return { base: commit, from: commit, whole: [], says: 'where the snapshot was recorded' };
  let named;
  try {
    named = git('diff', '--name-only', '--no-renames', start.from, commit);
  } catch {
    return {
      base: commit,
      from: start.from,
      whole: [],
      says: start.says,
      widened: `${start.from.slice(0, 12)}, ${start.says}, is not in this checkout`,
    };
  }
  const whole = [...new Set(lines(named))].sort();
  return {
    base: commit,
    from: start.from,
    whole,
    says: `${start.says}; ${whole.length} file(s) changed up to ${commit.slice(0, 12)}, where the snapshot was recorded, are read whole`,
  };
}

/**
 * The arguments that take the files charged whole out of a `git diff`, so none
 * of them is also read by its hunks. Literal, so a name is never a glob.
 */
export function excluding(whole) {
  return whole.length === 0 ? [] : ['--', '.', ...whole.map((file) => `:(exclude,literal)${file}`)];
}

/** A file named with no hunk, which the selector charges every region of. */
export const wholeEntry = (file) => `diff --git a/${file} b/${file}`;
