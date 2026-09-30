/**
 * Where the change `test:since` reads starts, for each test, which is not
 * always the commit the snapshot names.
 *
 * A snapshot names the commit of the latest run laid into it, not the commit
 * every observation in it was made at. A leg of `--at-distance` is a run: the
 * seam lands it and stamps the snapshot at `HEAD`, and every test the leg did
 * not run still stands on the text it last ran on. Read from the snapshot's
 * commit alone, the next leg finds nothing changed and runs nothing, which
 * skips the far half of the loop. `landRun` writes down where each test the
 * runs at this commit did not observe last ran, in `coverage.runs.json`, so it
 * is read here rather than worked out again or ignored.
 *
 * A ref on the command line is a lower bound: a test that last ran after the
 * merge base with it is read from the merge base instead, so a ref never reads
 * less than the runs would. That holds after every test has run at the
 * snapshot's commit too. A ref asks what the branch changed, and the rows hold
 * only what the snapshot commit's text ran, so the branch's files are charged
 * whole: a ref named on purpose reads the whole branch rather than the runs.
 *
 * What changed between where a test stands and the snapshot's commit is
 * charged whole for that test, and left out of the hunk diff it is read
 * through. The merge re-cuts the rows such a test carried onto the text on
 * disk, so its line numbers are the snapshot commit's; but it never ran that
 * text, and the regions it would have entered in the edit are not in its row.
 * A hunk read would ask the wrong question, and a both-texts reading of the
 * snapshot commit against the tree judges the wrong pair of texts and can call
 * the edit inert. Whole files select more inside them and never skip.
 */

/**
 * The paths of one git answer asked with `-z`, as git wrote them. Without `-z`,
 * git C-quotes a path holding a quote, a backslash, a tab or a newline whatever
 * `core.quotePath` says, and a trimmed line loses a path's own leading space.
 */
export const paths = (text) => text.split('\0').filter((path) => path !== '');

/** Whether `ancestor` is in the history of `commit`, asked of git. */
function isAncestor(git, ancestor, commit) {
  try {
    git('merge-base', '--is-ancestor', ancestor, commit);
    return true;
  } catch {
    return false;
  }
}

/**
 * The commit each of `tests` last ran at, as the runs beside the snapshot
 * recorded it.
 *
 * A test the runs at the snapshot's commit observed stands there. Any other
 * stands where `standing` lists it. Where the record does not say, the reading
 * falls back, and `assumed` is the sentence that says how: a test the record
 * does not list is read from `over`, where the runs at the snapshot's commit
 * started, and with no record for this snapshot at all, from the snapshot's
 * commit. Runs recorded at another commit describe some other snapshot and say
 * nothing about this one.
 */
export function standsOf({ commit, runs, tests }) {
  const stands = new Map(tests.map((test) => [test, commit]));
  const at = commit.slice(0, 12);
  const everyTest = `so every test is read as though it last ran at ${at}`;
  if (runs === undefined) return { stands, assumed: tests.length === 0 ? undefined : `no runs record lies beside the snapshot, ${everyTest}` };
  if (runs.commit !== commit) {
    const whose = runs.commit === undefined ? 'a run outside a checkout' : `${runs.commit.slice(0, 12)}'s`;
    return { stands, assumed: tests.length === 0 ? undefined : `the runs record beside the snapshot is ${whose}, not ${at}'s, ${everyTest}` };
  }
  const ran = new Set(runs.files);
  const listed = new Map();
  for (const entry of runs.standing ?? []) for (const file of entry.files) listed.set(file, entry.commit);
  const fallback = runs.over ?? commit;
  let unlisted = 0;
  for (const test of tests) {
    if (ran.has(test)) continue;
    if (!listed.has(test)) unlisted += 1;
    stands.set(test, listed.get(test) ?? fallback);
  }
  if (unlisted === 0) return { stands, assumed: undefined };
  const where = runs.over === undefined ? `${at}, where the snapshot was recorded` : `${runs.over.slice(0, 12)}, where its runs started`;
  return { stands, assumed: `the runs record beside the snapshot does not say where ${unlisted} test(s) last ran, so they are read from ${where}` };
}

/** The merge base with `ref`, or why there is none to read from. */
function mergeBase(git, ref) {
  try {
    git('rev-parse', '--verify', '--quiet', `${ref}^{commit}`);
  } catch {
    return { refused: `\`${ref}\` is not a commit this checkout knows` };
  }
  try {
    return { merged: git('merge-base', ref, 'HEAD').trim() };
  } catch {
    return { refused: `\`${ref}\` shares no history with HEAD` };
  }
}

/**
 * The reading `test:since` makes.
 *
 * `base` is the commit the hunk diff and the recorded text are read from.
 * `stands` are the older commits some tests last ran at, oldest first, each
 * with those tests and the files changed from it to `base`, which are charged
 * whole for them. `from` is the oldest of them, where the change starts, and
 * `says` is the header's words after it. A test in no stand is read from
 * `base`. `assumed` is present when the runs record could not say where some
 * test last ran, and is the sentence saying what was read instead; `says` ends
 * with it too.
 *
 * `runs` is `coverage.runs.json` beside the snapshot being read, which
 * describes that snapshot whichever layer holds it. `tests` are the snapshot's
 * test files the suite still collects: a deleted or renamed test keeps its row
 * in the snapshot and never runs again, and a stand only it holds would read
 * from that commit for ever. `refused` is a ref git cannot read. `widened` is a
 * stand git cannot read, such as one a rebase rewrote away and collected; the
 * caller then runs the whole suite rather than narrowing on half a change.
 */
export function readingFrom({ commit, ref, runs, tests = [], git }) {
  let merged;
  if (ref !== undefined) {
    const found = mergeBase(git, ref);
    if (found.refused !== undefined) return { refused: found.refused };
    merged = found.merged;
  }
  if (commit === undefined) return { base: merged, from: merged, stands: [], says: `the merge base with ${ref}` };

  const { stands, assumed } = standsOf({ commit, runs, tests });
  const also = assumed === undefined ? {} : { assumed };
  let note = '';
  if (merged !== undefined && merged !== commit) {
    if (isAncestor(git, merged, commit)) {
      const lower = new Map();
      for (const [test, stand] of stands) {
        if (!lower.has(stand)) lower.set(stand, stand !== merged && isAncestor(git, merged, stand));
        if (lower.get(stand)) stands.set(test, merged);
      }
    } else note = `; the merge base with ${ref} is not before it`;
  }

  // Oldest first: `standing` is in the record's own order, and `over` is where
  // the snapshot stood before the runs at its commit, which no test in
  // `standing` ran after. The merge base comes last: every stand descending
  // from it was lowered onto it above, so a stand still held is older.
  const order = [
    ...new Set([
      ...(runs?.commit === commit ? [...(runs.standing ?? []).map((entry) => entry.commit), ...(runs.over === undefined ? [] : [runs.over])] : []),
      ...(merged === undefined ? [] : [merged]),
    ]),
  ];
  const grouped = new Map();
  for (const [test, stand] of stands) {
    if (stand !== commit) grouped.set(stand, [...(grouped.get(stand) ?? []), test]);
  }
  const older = [...grouped.keys()].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  const said = assumed === undefined ? '' : `; ${assumed}`;
  if (older.length === 0) return { base: commit, from: commit, stands: [], says: `where the snapshot was recorded${note}${said}`, ...also };

  const at = commit.slice(0, 12);
  const from = older[0];
  const reason =
    from === merged ? `the merge base with ${ref}` : `where ${grouped.get(from).length} test(s) the runs at ${at} did not run last ran`;
  const read = [];
  for (const stand of older) {
    const standing = grouped.get(stand).sort();
    try {
      read.push({ commit: stand, tests: standing, whole: [...new Set(paths(git('diff', '--name-only', '-z', '--no-renames', stand, commit)))].sort() });
    } catch {
      return {
        base: commit,
        from,
        stands: [],
        says: `${reason}${said}`,
        ...also,
        widened: `${stand.slice(0, 12)}, where ${standing.length} test(s) last ran, is not in this checkout`,
      };
    }
  }
  const whole = new Set(read.flatMap((stand) => stand.whole));
  const count = read.reduce((sum, stand) => sum + stand.tests.length, 0);
  return {
    base: commit,
    from,
    stands: read,
    says: `${reason}${note}; ${whole.size} file(s) changed up to ${at}, where the snapshot was recorded, are read whole for the ${count} test(s) that last ran before it${said}`,
    ...also,
  };
}

/** A path as a `diff --git` header spells it, unquoted where git quoted it. */
function headerPath(rest) {
  if (!rest.startsWith('"')) return rest.slice(2, 2 + (rest.length - 5) / 2);
  const bytes = [];
  const escapes = { a: 7, b: 8, f: 12, n: 10, r: 13, t: 9, v: 11, '"': 34, '\\': 92 };
  for (let at = 1; at < rest.length && rest[at] !== '"'; at += 1) {
    if (rest[at] !== '\\') {
      const character = String.fromCodePoint(rest.codePointAt(at));
      bytes.push(...Buffer.from(character));
      at += character.length - 1;
    } else if (/[0-7]/.test(rest[at + 1] ?? '')) {
      bytes.push(Number.parseInt(rest.slice(at + 1, at + 4), 8));
      at += 3;
    } else {
      bytes.push(escapes[rest[at + 1]] ?? rest.charCodeAt(at + 1));
      at += 1;
    }
  }
  return Buffer.from(bytes).toString('utf8').slice(2);
}

/**
 * The diff with every section for one of `files` left out, so none of them is
 * also read by its hunks. Cut from the diff's own text rather than asked of git
 * with a pathspec per file, which a long branch would push past the argument
 * limit. A `diff --git` line at the start of a line is always a header: a hunk
 * line starts with a space, `+`, `-` or `\`.
 */
export function withoutFiles(diff, files) {
  if (files.length === 0) return diff;
  const drop = new Set(files);
  const out = [];
  let keep = true;
  for (const line of diff.split('\n')) {
    if (line.startsWith('diff --git ')) keep = !drop.has(headerPath(line.slice('diff --git '.length)));
    if (keep) out.push(line);
  }
  return out.join('\n');
}

/** A file named with no hunk, which the selector charges every region of. */
export const wholeEntry = (file) => `diff --git a/${file} b/${file}`;
