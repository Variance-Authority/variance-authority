import ciInfo from 'ci-info';

/**
 * A case whose subject is missing: no browser, no built CLI, no Storybook
 * build, no page bundle, no incumbent run.
 *
 * On a developer's machine building the subject is theirs to do, so the case
 * skips and `message` says how to build it. On CI a missing subject is a
 * missing step: a case that skips there leaves the check green, and a file
 * whose cases all skipped never ran, so the record the run makes is not whole
 * and `main` cannot publish it. A CI run without the subject fails instead,
 * naming what to build.
 *
 * @param {string} message What is missing and the command that builds it.
 * @param {boolean} [ci] Whether this is a CI run, as `ci-info` decides.
 */
export function unbuilt(message, ci = ciInfo.isCI) {
  if (!ci) {
    console.warn(message);
    return;
  }
  const named = message.trim().replace(/: skipped\.$/m, ': not run.');
  throw new Error(`${named}\n  CI runs this case rather than skip it: provide what it names in this job, as \`./.github/actions/case-subjects\` builds the subjects.`);
}
