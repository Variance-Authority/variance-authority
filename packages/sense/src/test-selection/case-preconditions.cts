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
 * every call as a sixth field of its owner, beside the journey. The fold
 * resolves them with {@link resolve}: the body overrides a `beforeEach`, an
 * inner `describe`'s `beforeEach` an outer one's, and two values at one level
 * are both kept, because a contradiction is reported and not resolved.
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

/** One precondition on a case's row: what was said, and where. */
interface CasePrecondition {
  readonly name: string;
  readonly value: Value;
  /** The repository-relative `file:line` of the call that said it. */
  readonly site: string;
  /** The level it was said at, as {@link Said} carries it: what a later merge resolves by. */
  readonly level: number;
}

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
 * @param root The checkout, where the realm knows it: what the recorder warns
 * and throws then names a call site as the row does, from the checkout.
 */
function recorder(
  holder: object,
  running: () => string | undefined,
  context?: { run<Result>(store: Where, body: () => Result): Result; getStore(): Where | undefined },
  root?: string,
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
  const told = (site: string): string => root === undefined ? site : checkoutSite(root, site);

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
          `variance-authority: variancePrecondition at ${told(site)} ran after its case and is recorded on no case — ` +
            'say what a case arranged before it runs',
        );
        return;
      case 'outside':
        throw Object.assign(
          new Error(
            `variance-authority: variancePrecondition at ${told(site)} ${at.because} — a precondition belongs to the ` +
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
        `variance-authority: variancePrecondition at ${told(site)} takes a name and a string, number or boolean, ` +
          'or a record of them; nothing was recorded',
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

/** A call's arguments as name-value pairs, or nothing when they are not a precondition. */
function entriesOf(named: unknown, value: unknown): readonly (readonly [string, Value])[] | undefined {
  if (typeof named === 'string') {
    if (named === '') return undefined;
    if (value === undefined) return [[named, true]];
    return isValue(value) ? [[named, value]] : undefined;
  }
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
 * A site as every other row names a file: a path, a `file:` URL, or a dev
 * server's `/@fs/` URL becomes repository-relative. A site that names no file
 * under the checkout is kept as the realm spelled it.
 *
 * The builtins are looked up when a site is named rather than required at the
 * top: this module is bundled into a Vitest config, where a `require` of a
 * builtin is refused, and it loads in realms that have none.
 */
function checkoutSite(root: string, site: string): string {
  const colon = site.lastIndexOf(':');
  if (colon <= 0) return site;
  const path = process.getBuiltinModule('node:path');
  const url = process.getBuiltinModule('node:url');
  let file = site.slice(0, colon);
  if (file.startsWith('file:')) file = url.fileURLToPath(file);
  else if (/^https?:/u.test(file)) {
    const served = /\/@fs(\/.*)$/u.exec(new URL(file).pathname);
    // FIXME: a browser realm's site served from the dev server's root, not
    // `/@fs/`, keeps its URL — needs the server's root to name the file.
    if (served === null) return site;
    file = decodeURIComponent(served[1]!);
  }
  // `projectPath`'s spelling: relative to the checkout, with `/` on every platform.
  return path.isAbsolute(file) ? `${path.relative(root, file).split(path.sep).join('/')}${site.slice(colon)}` : site;
}

/**
 * A packed case coordinate carrying what the case said, as a sixth field.
 *
 * The field follows the journey, which stays empty when the case has none, so
 * a reader that knows five fields reads the case unchanged. An empty field is a
 * case that said nothing under a recorder that was listening; no field at all
 * is a frame from a writer that never listened, which a reader may not take for
 * a case with no preconditions.
 */
function packSaid(packed: string, said: readonly Said[]): string {
  const fields = packed.split('\u0000').length;
  return `${packed}${'\u0000'.repeat(Math.max(1, 6 - fields))}${said.length === 0 ? '' : JSON.stringify(said)}`;
}

/** What a frame owner says its case arranged, or nothing when it does not say. */
function saidOf(packed: string): readonly Said[] | undefined {
  const fields = packed.split('\u0000');
  if (fields.length < 6) return undefined;
  const field = fields[5]!;
  if (field === '') return [];
  const parsed = JSON.parse(field) as unknown;
  if (!Array.isArray(parsed)) throw new Error('not a variance-authority case journal');
  return parsed as Said[];
}

/**
 * A case's preconditions from everything said for it, across its frames.
 *
 * Per name, the narrowest level that said it wins. Every distinct value said at
 * that level is kept, at the site of the call that said it first — the calls
 * arrive in the order they were made, a later frame's after an earlier one's.
 * One value is the answer, two are a contradiction the reader reports — a retry
 * that says something else is the same contradiction. Ordered by name, then
 * value, so which names and values a row holds is the same whichever worker
 * wrote first; the site is the earliest call's, so across merged records it is
 * the one from the record passed first.
 */
function resolve(said: readonly Said[]): CasePrecondition[] {
  const byName = new Map<string, Said[]>();
  for (const entry of said) {
    const held = byName.get(entry[0]);
    if (held === undefined) byName.set(entry[0], [entry]);
    else held.push(entry);
  }
  const resolved: CasePrecondition[] = [];
  for (const [name, entries] of byName) {
    const narrowest = Math.max(...entries.map((entry) => entry[3]));
    const values = new Map<string, CasePrecondition>();
    for (const [, value, site, level] of entries) {
      if (level !== narrowest) continue;
      const key = `${typeof value}:${String(value)}`;
      if (!values.has(key)) values.set(key, { name, value, site, level });
    }
    resolved.push(...values.values());
  }
  return resolved.sort((left, right) =>
    order(left.name, right.name) || order(`${typeof left.value}:${String(left.value)}`, `${typeof right.value}:${String(right.value)}`));
}

/** The names said with more than one value at the level that decides them. */
function contradictions(preconditions: readonly CasePrecondition[]): readonly string[] {
  const seen = new Set<string>();
  const twice = new Set<string>();
  for (const { name } of preconditions) (seen.has(name) ? twice : seen).add(name);
  return [...twice];
}

function order(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export = { PRECONDITION, MISPLACED, CASE_LEVEL, recorder, entriesOf, siteOf, checkoutSite, packSaid, saidOf, resolve, contradictions };
