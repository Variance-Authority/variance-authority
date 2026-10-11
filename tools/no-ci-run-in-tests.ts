/**
 * A test never inherits the CI run that runs it.
 *
 * GitHub Actions sets its `GITHUB_*` variables for the runner, and every worker
 * the runner forks inherits them. Code here reads them to name the pull request
 * a review is for, the branch a line is shared on and the run a history entry
 * belongs to. Left set, a test that calls that code without an environment of
 * its own takes one path on `main`'s push run and another on a pull request's
 * run, and the review of every pull request reports the difference as motion
 * the change made. A test that means a CI run passes it as an environment.
 *
 * The runner has read them by the time a worker loads this, so they are
 * removed from the worker's environment before any test file runs.
 */

for (const name of Object.keys(process.env)) {
  if (name.startsWith('GITHUB_')) delete process.env[name];
}
