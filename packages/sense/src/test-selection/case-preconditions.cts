/**
 * What a case said it arranged, from the call to the case frame.
 *
 * `variancePrecondition` in a test reads one function off the realm, which
 * {@link recorder} installs where a case scope exists, and hands it the name,
 * the value and an `Error` whose stack holds the call site. A precondition
 * belongs to a case: the recorder lays a call on the case running it — said in
 * the case body, or in a `beforeEach` running for the case — and throws for a
 * call no case is running, which a `describe` callback, a `beforeAll`, a file's
 * top level and work that outlives its case all are. The case frame carries
 * every call as a sixth field of its owner, beside the journey, and the
 * addon's `case_said.rs` does the rest: it joins, stores and resolves them.
 *
 * A runner tells the recorder where a call stands, because only the runner
 * knows which hook is running: the case scope gains `phase`, for a runner that
 * announces hooks as events (jest-circus), `within`, for one whose hooks are
 * wrapped (Vitest, Rstest), and `where`, asked when neither says anything.
 *
 * CommonJS for the reason `journal-format.cts` is: both writers of a case frame
 * run inside somebody else's sandbox.
 */

/** Where `@variance-authority/sense/precondition` finds the recorder. */
const PRECONDITION = Symbol.for('variance-authority.test-selection.precondition');

/**
 * Marks the error a call made where no case runs throws, which the entry lets
 * through: every other error a recorder throws is the recorder's own bug.
 */
const MISPLACED = Symbol.for('variance-authority.test-selection.precondition.misplaced');

/** A precondition's value. Without one, the state is present: `true`. */
type Value = string | number | boolean;

/**
 * One call as a frame carries it: name, value, `file:line`, level.
 *
 * The level is how deep the `beforeEach` that said it was declared: `0` the
 * file's, `n` the `n`-th nested `describe`'s, {@link CASE_LEVEL} the case body.
 */
type Said = readonly [name: string, value: Value, site: string, level: number];

/** The level of a call made from the case body, narrower than any `beforeEach`. */
const CASE_LEVEL = 0xffff;

/**
 * Where a call stands, as the runner knows it.
 *
 * - `each`: a `beforeEach` declared `depth` describes deep, running for the case
 *   `case` names — or, where the runner cannot name it, for the next case
 *   entered with the same `token`, the handle the runner gives both.
 * - `after`: an `afterEach`, which runs for a case and is not Arrange.
 * - `outside`: no case is running; `because` finishes the sentence it throws.
 */
type Where =
  | { readonly kind: 'each'; readonly depth: number; readonly case?: string; readonly token?: unknown }
  | { readonly kind: 'after' }
  | { readonly kind: 'outside'; readonly because: string };

/**
 * The recorder for one realm's case scope.
 *
 * @param running The case running now, as its packed key, or nothing where no
 * case body is running.
 * @param context An async store for {@link within}, where the realm has one:
 * hooks of concurrent cases interleave at every await, and a variable set
 * around one of them is read by the other.
 * @param siteNamed How a warning names a call site, where the realm can name it as
 * the row does, from the checkout; as the realm spelled it otherwise.
 */
function recorder(
  holder: object,
  running: () => string | undefined,
  context?: { run<Result>(store: Where, body: () => Result): Result; getStore(): Where | undefined },
  siteNamed: (site: string) => string = (site) => site,
): {
  phase(where: Where | undefined): void;
  within<Result>(where: Where, body: () => Result): Result;
  where: { ask?: () => Where | undefined };
  /** A case is starting: forget what a `beforeEach` said under `token` before it. */
  begin(token?: unknown): void;
  /** The case `key` names is entered: what its `beforeEach`es said is its own. */
  entered(key: string, token?: unknown): void;
  take(key: string): Said[];
  /** What the case `key` names has said so far, left in place for {@link take}. */
  held(key: string): readonly Said[];
  /** Forget the file: a collector, and its recorder, end with their file. */
  finish(): void;
} {
  const byCase = new Map<string, Said[]>();
  // What a `beforeEach` said before the runner entered the case, under the
  // token the runner hands both. A case that is never entered — its
  // `beforeEach` threw — leaves its calls here until the next case begins.
  const pending = new Map<unknown, Said[]>();
  let phase: Where | undefined;
  const where: { ask?: () => Where | undefined } = {};

  const onCase = (key: string, said: readonly Said[]): void => {
    const held = byCase.get(key);
    if (held === undefined) byCase.set(key, [...said]);
    else held.push(...said);
  };
  const say = (entries: readonly (readonly [string, Value])[], site: string): void => {
    const key = running();
    if (key !== undefined) {
      onCase(key, entries.map(([name, value]) => [name, value, site, CASE_LEVEL]));
      return;
    }
    const at = context?.getStore() ?? phase ?? where.ask?.() ?? { kind: 'outside', because: 'ran outside a running case' };
    switch (at.kind) {
      case 'each': {
        const said = entries.map(([name, value]): Said => [name, value, site, at.depth]);
        if (at.case !== undefined) onCase(at.case, said);
        else pending.set(at.token, [...(pending.get(at.token) ?? []), ...said]);
        return;
      }
      case 'after':
        console.warn(
          `variance-authority: variancePrecondition at ${siteNamed(site)} ran after its case and is recorded on no case — ` +
            'say what a case arranged before it runs',
        );
        return;
      case 'outside':
        throw Object.assign(
          new Error(
            `variance-authority: variancePrecondition at ${siteNamed(site)} ${at.because} — a precondition belongs to the ` +
              'case it arranged, so say it in the case body or in a beforeEach',
          ),
          { [MISPLACED]: true },
        );
    }
  };

  (holder as { [PRECONDITION]?: unknown })[PRECONDITION] = (
    named: unknown,
    value: unknown,
    called: unknown,
  ): void => {
    const site = siteOf(called);
    const entries = entriesOf(named, value);
    if (entries === undefined) {
      console.warn(
        `variance-authority: variancePrecondition at ${siteNamed(site)} takes a record of names to a string, number or boolean; ` +
          'nothing was recorded',
      );
      return;
    }
    say(entries, site);
  };

  return {
    phase(next) {
      phase = next;
    },
    within(at, body) {
      if (context !== undefined) return context.run(at, body);
      const before = phase;
      phase = at;
      let answered;
      try {
        answered = body();
      } catch (thrown) {
        phase = before;
        throw thrown;
      }
      const thenable = answered as { then?: unknown } | null | undefined;
      if (thenable == null || typeof thenable.then !== 'function') {
        phase = before;
        return answered;
      }
      return (answered as unknown as Promise<unknown>).then(
        (settled) => { phase = before; return settled; },
        (thrown: unknown) => { phase = before; throw thrown; },
      ) as typeof answered;
    },
    where,
    begin(token) {
      pending.delete(token);
    },
    entered(key, token) {
      const held = pending.get(token);
      if (held === undefined) return;
      pending.delete(token);
      onCase(key, held);
    },
    take(key) {
      const own = byCase.get(key) ?? [];
      byCase.delete(key);
      return own;
    },
    held: (key) => [...(byCase.get(key) ?? [])],
    finish() {
      byCase.clear();
      pending.clear();
    },
  };
}

/** A call's record as name-value pairs, or nothing when the call is not one record of them. */
function entriesOf(named: unknown, value: unknown): readonly (readonly [string, Value])[] | undefined {
  if (named === null || typeof named !== 'object' || Array.isArray(named) || value !== undefined) return undefined;
  const entries: (readonly [string, Value])[] = [];
  for (const [name, held] of Object.entries(named as Record<string, unknown>)) {
    if (name === '' || !isValue(held)) return undefined;
    entries.push([name, held]);
  }
  return entries;
}

function isValue(value: unknown): value is Value {
  return typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
}

/**
 * The caller's `file:line`, off the stack of the `Error` the entry made.
 *
 * The first frame is the entry itself, so the second is whoever called it. V8
 * spells a frame `at name (file:line:column)`, Firefox and Safari
 * `name@file:line:column`; both end in the location.
 */
function siteOf(called: unknown): string {
  const stack = (called as { stack?: unknown } | undefined)?.stack;
  if (typeof stack !== 'string') return '';
  let seen = 0;
  for (const line of stack.split('\n')) {
    // The location may hold `@` itself: a dev server serves a file outside its
    // root at `/@fs/`, and only the first `@` of a Firefox frame ends the name.
    const found = /(?:\(|@|at )([^()@\s][^()]*?):(\d+):\d+\)?\s*$/.exec(line);
    if (found === null) continue;
    seen += 1;
    if (seen === 2) return `${found[1]}:${found[2]}`;
  }
  return '';
}

/**
 * A packed case coordinate carrying what the case said, as its sixth field.
 *
 * Set at its index, as `case-owner.cts` sets every field after the
 * coordinate, so the project after it stays where its reader looks. The field
 * is always JSON: `[]` is a case that said nothing under a recorder that was
 * listening; an empty or missing field is a frame from a writer that never
 * listened, which a reader may not take for a case with no preconditions.
 */
const SAID_FIELD = 5;

function packSaid(packed: string, said: readonly Said[]): string {
  const fields = packed.split('\u0000');
  while (fields.length <= SAID_FIELD) fields.push('');
  fields[SAID_FIELD] = JSON.stringify(said);
  return fields.join('\u0000');
}

/** A frame owner's sixth field, as the realm wrote it; absent where its writer never listened. */
function saidField(packed: string): string | undefined {
  const field = packed.split('\u0000')[SAID_FIELD];
  return field === undefined || field === '' ? undefined : field;
}

export = { PRECONDITION, MISPLACED, CASE_LEVEL, recorder, entriesOf, siteOf, packSaid, saidField };
