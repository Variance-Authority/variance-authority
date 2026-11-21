/**
 * Mark a check in a case body, so a case that passes without reaching it is
 * named rather than read as verified.
 *
 * The check is declared by where it stands, read from the test file before the
 * run (`case_checks.rs`): a `checked` call in a case body, or in a helper of the
 * same file the body calls, at the line the body calls it. Its id is a string
 * literal; one built at run time declares nothing.
 *
 * The entry imports nothing: it reads the case scope a recording installs on
 * the realm, in Node and in a browser realm alike.
 */

/** Where a recording keeps the running case's scope; mirrors `CASE_SCOPE` in `cases.ts`. */
const CASE_SCOPE = Symbol.for('variance-authority.test-selection.cases');

type Scope = { readonly checked?: (id: string) => unknown } | undefined;

/**
 * Run the check `fn` under `id`, and return what it returns:
 * `checked('create-event/submitted-title', () => expect(sent.title).toBe('Launch'))`.
 *
 * The running attempt entered the check when the call is made, before `fn`
 * runs. Outside a recording it runs `fn` and nothing else, and an error in
 * recording never fails the case.
 *
 * @see https://variance-authority.dev/reference/packages/sense#name-the-check-a-case-is-there-for
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
