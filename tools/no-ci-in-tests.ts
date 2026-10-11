/**
 * A test never inherits the CI job that runs it.
 *
 * GitHub Actions describes the job in `GITHUB_*` variables, and the product
 * reads them from `process.env` wherever no caller passes an environment. The
 * CLI passes none, so a test that runs a command through `main` inherits the
 * job. Left set, a test that reviews or reads a share behaves as if it ran for
 * the event that started this suite. On a push it stops at the event's name; on a pull request
 * it reads the event file and names a head. The recording made on the
 * mainline's push then disagrees with every pull request's about which lines
 * those tests ran, and the review reports them as no longer run.
 *
 * So the worker's environment holds none of them before any test file runs. A
 * test that needs a CI job passes the environment, or stubs it, itself.
 */

for (const name of Object.keys(process.env)) {
  if (name.startsWith('GITHUB_')) delete process.env[name];
}
