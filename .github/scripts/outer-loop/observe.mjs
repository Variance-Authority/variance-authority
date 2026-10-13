// What a consumer sees on a pull request, held against what the flow declares.
//
// Pure: each function takes what the driver fetched and returns the sentences
// that are wrong with it, empty when nothing is. The driver fails with all of
// them at once, so one red run names every broken promise rather than the
// first.

import { DOCKET_MARKER, NEEDS_REVIEW } from './flows.mjs';

/** The comment that opens with `marker`, or `undefined`. */
export function commentWith(comments, marker) {
  return comments.find((comment) => comment.body?.startsWith(marker));
}

/**
 * The change pull request's first runs: the gate red because of the change,
 * every other check green, the docket naming the change, and — where the flow
 * records unit tests — the two review comments and the selection.
 */
export function changeProblems(flow, { checks, annotations, comments, logs }) {
  const problems = [];
  for (const name of flow.checks) {
    const run = checks[name];
    const wanted = name === flow.gate ? 'failure' : 'success';
    if (run.conclusion !== wanted) {
      problems.push(
        `check \`${name}\` concluded ${run.conclusion}, expected ${wanted}${said(annotations[name])}`,
      );
    }
  }
  const gate = annotations[flow.gate] ?? [];
  if (checks[flow.gate].conclusion === 'failure' && !gate.some((a) => a.message.includes(NEEDS_REVIEW))) {
    problems.push(`check \`${flow.gate}\` is red, but not because changes need review${said(gate)}`);
  }

  const docket = commentWith(comments, DOCKET_MARKER);
  if (docket === undefined) {
    problems.push(`no docket comment (${DOCKET_MARKER}) on the pull request`);
  } else {
    if (!docket.body.includes('need review')) {
      problems.push(`the docket does not say anything needs review: ${firstLine(docket.body)}`);
    }
    for (const name of flow.docket) {
      if (!docket.body.includes(name)) problems.push(`the docket does not name \`${name}\``);
    }
  }

  if (flow.unit !== undefined) problems.push(...unitProblems(flow.unit, comments, logs[flow.unit.check] ?? ''));
  return problems;
}

/**
 * The unit-test half: "What this change might do" names the tests that stand
 * on the changed file and no other, the evidence comment says they ran it, and
 * the test run selected only them.
 *
 * Read from the comments' table rows, because the comments also name tests in
 * prose that is about the recording rather than the selection.
 */
function unitProblems(unit, comments, log) {
  const problems = [];
  for (const [what, marker] of [
    ['might-do', unit.might],
    ['evidence', unit.evidence],
  ]) {
    const comment = commentWith(comments, marker);
    if (comment === undefined) {
      problems.push(`no ${what} comment (${marker}) on the pull request`);
      continue;
    }
    const rows = comment.body.split('\n').filter((line) => line.startsWith('|'));
    const onFile = rows.filter((row) => row.includes(`\`${unit.file}`));
    for (const test of unit.tests) {
      if (!onFile.some((row) => row.includes(`\`${test}\``))) {
        problems.push(`the ${what} comment has no row naming \`${test}\` for \`${unit.file}\``);
      }
    }
    for (const test of unit.untouched) {
      if (rows.some((row) => row.includes(`\`${test}\``))) {
        problems.push(`the ${what} comment names \`${test}\`, which the change does not reach`);
      }
    }
  }
  if (!log.includes(unit.selected)) {
    problems.push(`the \`${unit.check}\` log does not say "${unit.selected}"`);
  }
  for (const test of unit.untouched) {
    if (log.includes(`${test} (`)) problems.push(`the \`${unit.check}\` log ran \`${test}\``);
  }
  return problems;
}

/**
 * The control pull request: every check green, nothing pushed back, and no
 * docket asking for review.
 */
export function controlProblems(flow, { checks, annotations, comments, head, opened }) {
  const problems = [];
  for (const name of flow.checks) {
    if (checks[name].conclusion !== 'success') {
      problems.push(`control: check \`${name}\` concluded ${checks[name].conclusion}${said(annotations[name])}`);
    }
  }
  if (head !== opened) problems.push(`control: the branch moved from ${opened} to ${head}; nothing should push to it`);
  const docket = commentWith(comments, DOCKET_MARKER);
  if (docket?.body.includes('need review')) {
    problems.push(`control: the docket asks for review: ${firstLine(docket.body)}`);
  }
  return problems;
}

/** The accepted run: the gate green on the same change. */
export function acceptedProblems(flow, run, annotations) {
  return run.conclusion === 'success'
    ? []
    : [`after the accept, check \`${flow.gate}\` concluded ${run.conclusion}${said(annotations)}`];
}

/**
 * The commit the label's run pushed back to the branch: the action's bot, its
 * message, on top of the change, touching the changed page's images and
 * nothing else.
 */
export function commitProblems(flow, commit, parent) {
  const problems = [];
  const expected = flow.commit;
  if (commit.author?.login !== expected.author) {
    problems.push(`the accept commit is by ${commit.author?.login ?? 'nobody GitHub knows'}, not ${expected.author}`);
  }
  if (!commit.commit.message.startsWith(expected.message)) {
    problems.push(`the accept commit's message opens "${firstLine(commit.commit.message)}"`);
  }
  if (commit.parents[0]?.sha !== parent) {
    problems.push(`the accept commit's parent is ${commit.parents[0]?.sha}, not the change ${parent}`);
  }
  // FIXME: asserts the layout cli 0.15.0 writes. The readable, collocated
  // baseline paths change (on its own branch) moves where an accepted image
  // lands; when the examples install the release that carries it, `files` in
  // flows.mjs follows.
  const names = commit.files.map((file) => file.filename);
  for (const pattern of expected.files) {
    if (!names.some((name) => pattern.test(name))) problems.push(`the accept commit touches nothing matching ${pattern}`);
  }
  for (const name of names) {
    if (!expected.files.some((pattern) => pattern.test(name))) {
      problems.push(`the accept commit touches \`${name}\`, which the change did not reach`);
    }
  }
  return problems;
}

/**
 * The deployment's build of the change: exactly the declared subjects changed,
 * each one a reviewer can approve.
 */
export function buildProblems(flow, build) {
  const changed = build.subjects.filter((subject) => subject.verdict === 'changed');
  const names = changed.map((subject) => subject.subject).toSorted();
  const wanted = flow.subjects.toSorted();
  const problems = [];
  if (names.join('\n') !== wanted.join('\n')) {
    problems.push(`the build ${build.build} changed [${names.join(', ')}], expected [${wanted.join(', ')}]`);
  }
  for (const subject of changed) {
    if (subject.approvable !== true) problems.push(`${subject.subject} is not approvable on the build page`);
  }
  return problems;
}

function said(annotations) {
  const messages = (annotations ?? []).map((a) => a.message).filter(Boolean);
  return messages.length === 0 ? '' : `: ${messages.join(' / ')}`;
}

function firstLine(text) {
  return text.split('\n').find((line) => line.trim() !== '' && !line.startsWith('<!--')) ?? '';
}
