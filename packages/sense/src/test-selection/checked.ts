/**
 * Mark a check in a case body, so a case that passes without reaching it is
 * named rather than read as verified.
 *
 * A case that asserts only on one branch passes on the other with nothing
 * checked. Written as `checked(id, fn)`, the check is declared by where it
 * stands: before the run, the index reads each case body in its test file and
 * keeps the ids of the `checked` calls there, and of those in a helper of the
 * same file the body calls, at the line the body calls it. During the run the
 * call tells the running case's scope it entered the check, under the attempt
 * the scope counts. `variance ask not-run` names each check a passing attempt
 * did not enter, with the line of its case and of its call.
 *
 * The id is read from the source, so it is a string literal: one built at run
 * time — a template with an expression, a variable — declares nothing, and a
 * case that bypasses it is not named.
 *
 * The entry imports nothing. It reads the case scope a recording installs on
 * the realm, in Node and in a browser realm alike; without a recording, or
 * where no case runs, it runs `fn` and nothing else. An error the scope throws
 * is swallowed: a bug in recording may not become a failing test.
 */

/** Where a recording keeps the running case's scope; mirrors `CASE_SCOPE` in `cases.ts`. */
const CASE_SCOPE = Symbol.for('variance-authority.test-selection.cases');

type Scope = { readonly checked?: (id: string) => unknown } | undefined;

/**
 * Run the check `fn` under `id`, and return what it returns:
 * `checked('create-event/submitted-title', () => expect(sent.title).toBe('Launch'))`.
 *
 * The running case's attempt entered the check when the call is made, before
 * `fn` runs: a check that throws fails the attempt, which then is not judged.
 *
 * @see https://variance-authority.dev/docs/agent-cli#a-check-a-case-passed-without
 */
export function checked<Result>(id: string, fn: () => Result): Result {
  const scope = (globalThis as { [CASE_SCOPE]?: Scope })[CASE_SCOPE];
  try {
    scope?.checked?.(id);
  } catch {
    // A recorder's bug may not become a bug in the test it records.
  }
  return fn();
}
