/**
 * What a case said it arranged, and what the code read while it ran, from the
 * call to the case frame.
 *
 * `variancePrecondition` in a test reads one function off the realm, which
 * {@link recorder} installs where a case scope exists, and hands it the
 * dimension, the record and an `Error` whose stack holds the call site;
 * `varianceBreadcrumb` in the code under test reads another, beside it, and
 * hands it the dimension, the key and the value it read: first alone, and the
 * answer `true` says the read is new to its case, so the entry calls again with
 * the `Error` that names the site. A key read on every render costs a lookup
 * after the first. A precondition
 * belongs to a case: the recorder lays a call on the case running it — said in
 * the case body, or in a `beforeEach` running for the case — and throws for a
 * call no case is running, which a `describe` callback, a `beforeAll`, a file's
 * top level and work that outlives its case all are. The case frame carries
 * every call as a sixth field of its owner, beside the journey, and the
 * addon's `case_said.rs` does the rest: it joins, stores and resolves them.
 *
 * A read belongs to the case running it too, but it never throws: the code
 * under test reads where it reads. A read while the file loads is every case's
 * of the file, at level `0`; a read after load where no case runs is warned
 * about and recorded on no case.
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

/** Where `@variance-authority/event`'s `varianceBreadcrumb` finds the recorder. */
const BREADCRUMB = Symbol.for('variance-authority.test-selection.breadcrumb');

/**
 * Marks the error a call that is the test's mistake throws — said where no
 * case runs, or under a dimension holding `:` — which the entry lets through:
 * every other error a recorder throws is the recorder's own bug.
 */
const MISPLACED = Symbol.for('variance-authority.test-selection.precondition.misplaced');

/**
 * What a misused read is named under: the empty dimension, which no
 * well-formed name has, then the dimension and key it was handed.
 */
const MISUSED = ':';

/** What the reads made while the file loads are seen under. */
const LOADING = Symbol('loading');

/**
 * One call as a frame carries it: `dimension:key`, the value's JSON text — or
 * `null` where JSON cannot hold it — `file:line`, and level.
 *
 * The level is how deep the `beforeEach` that said it was declared: `0` the
 * file's, `n` the `n`-th nested `describe`'s, {@link CASE_LEVEL} the case body.
 * A read is at {@link CASE_LEVEL} where a case runs it, and at `0` while the
 * file loads.
 */
type Said = readonly [name: string, value: string | null, site: string, level: number];

/** What a case said and what the code read in it; `read` absent where nobody listened to reads. */
interface Heard {
  readonly said: readonly Said[];
  readonly read?: readonly Said[];
}

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
 * @param reads Whether the realm listens to `varianceBreadcrumb` too: a test
 * runner's realm, which tells the recorder when its file has loaded, does; the
 * Playwright listener's, which runs no code under test, does not.
 */
function recorder(
  holder: object,
  running: () => string | undefined,
  context?: { run<Result>(store: Where, body: () => Result): Result; getStore(): Where | undefined },
  siteNamed: (site: string) => string = (site) => site,
  reads = false,
): {
  phase(where: Where | undefined): void;
  within<Result>(where: Where, body: () => Result): Result;
  where: { ask?: () => Where | undefined };
  /** A case is starting: forget what a `beforeEach` said under `token` before it. */
  begin(token?: unknown): void;
  /** The case `key` names is entered: what its `beforeEach`es said is its own. */
  entered(key: string, token?: unknown): void;
  /** The file has loaded: a read from now on is a case's, or nobody's. */
  loaded(): void;
  take(key: string): Heard;
  /** What the case `key` names has said so far, left in place for {@link take}. */
  held(key: string): readonly Said[];
  /** Forget the file: a collector, and its recorder, end with their file. */
  finish(): void;
} {
  const byCase = new Map<string, Said[]>();
  const readByCase = new Map<string, Said[]>();
  // What a `beforeEach` said, or the code read under it, before the runner
  // entered the case, under the token the runner hands both. A case that is
  // never entered — its `beforeEach` threw — leaves its calls here until the
  // next case begins.
  const pending = new Map<unknown, Said[]>();
  const pendingRead = new Map<unknown, Said[]>();
  // What the code read while the file loaded, which every case of the file ran on.
  const atLoad: Said[] = [];
  let loading = true;
  // A read site already warned about, so a read in a loop warns once.
  const warned = new Set<string>();
  let phase: Where | undefined;
  const where: { ask?: () => Where | undefined } = {};

  const onto = (into: Map<string, Said[]>, key: string, said: readonly Said[]): void => {
    const held = into.get(key);
    if (held === undefined) into.set(key, [...said]);
    else held.push(...said);
  };
  const standing = (): Where =>
    context?.getStore() ?? phase ?? where.ask?.() ?? { kind: 'outside', because: 'ran outside a running case' };
  const say = (entries: readonly (readonly [string, string | null])[], site: string): void => {
    const key = running();
    if (key !== undefined) {
      onto(byCase, key, entries.map(([name, value]) => [name, value, site, CASE_LEVEL]));
      return;
    }
    const at = standing();
    switch (at.kind) {
      case 'each': {
        const said = entries.map(([name, value]): Said => [name, value, site, at.depth]);
        if (at.case !== undefined) onto(byCase, at.case, said);
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

  // Where a read made now lands, and what its seen set is kept under: the
  // running case's key, the token of a `beforeEach` not yet entered, or the
  // file's load. Nothing where no case runs.
  const readTo = (): { readonly under: unknown; lay(held: Said): void } | undefined => {
    const key = running();
    if (key !== undefined) return { under: key, lay: (held) => onto(readByCase, key, [held]) };
    if (loading) return { under: LOADING, lay: ([name, value, site]) => atLoad.push([name, value, site, 0]) };
    const at = standing();
    if (at.kind !== 'each') return undefined;
    // A read under a `beforeEach` is the case's: the code ran for it.
    const { case: entered, token } = at;
    if (entered !== undefined) return { under: entered, lay: (held) => onto(readByCase, entered, [held]) };
    return { under: token, lay: (held) => pendingRead.set(token, [...(pendingRead.get(token) ?? []), held]) };
  };
  // Each `(name, value)` read so far under each `under`, so a key read on every
  // render costs a set lookup after its first read, and no site.
  const seenReads = new Map<unknown, Set<string>>();

  const read = (name: string, value: string | null, called: unknown): boolean => {
    const to = readTo();
    if (to === undefined) {
      if (called === undefined) return true;
      const site = siteOf(called);
      if (warned.has(site)) return false;
      warned.add(site);
      // FIXME: spec 0102 counts a read no case runs on its file, with its site,
      // and lays a `beforeAll`'s read on every case of its describe.
      console.warn(
        `variance-authority: varianceBreadcrumb at ${siteNamed(site)} read ${name} where no case runs and is recorded on no case`,
      );
      return false;
    }
    const item = JSON.stringify([name, value]);
    const seen = seenReads.get(to.under);
    if (seen?.has(item) === true) return false;
    if (called === undefined) return true;
    if (seen === undefined) seenReads.set(to.under, new Set([item]));
    else seen.add(item);
    to.lay([name, value, siteOf(called), CASE_LEVEL]);
    return false;
  };

  (holder as { [PRECONDITION]?: unknown })[PRECONDITION] = (
    dimension: unknown,
    record: unknown,
    called: unknown,
  ): void => {
    const site = siteOf(called);
    if (typeof dimension === 'string' && dimension.includes(':')) {
      throw Object.assign(
        new Error(
          `variance-authority: variancePrecondition at ${siteNamed(site)} names the dimension ${JSON.stringify(dimension)}, ` +
            'which holds `:` — a name is `dimension:key`, split at its first `:`',
        ),
        { [MISPLACED]: true },
      );
    }
    const entries = entriesOf(dimension, record);
    if (entries === undefined) {
      console.warn(
        `variance-authority: variancePrecondition at ${siteNamed(site)} takes a dimension and a record of keys to values; ` +
          'nothing was recorded',
      );
      return;
    }
    say(entries, site);
  };
  if (reads) {
    (holder as { [BREADCRUMB]?: unknown })[BREADCRUMB] = (
      dimension: unknown,
      key: unknown,
      value: unknown,
      called?: unknown,
    ): boolean => read(readName(dimension, key), jsonText(value), called);
  }

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
      pendingRead.delete(token);
      seenReads.delete(token);
    },
    entered(key, token) {
      for (const [from, into] of [[pending, byCase], [pendingRead, readByCase]] as const) {
        const held = from.get(token);
        if (held === undefined) continue;
        from.delete(token);
        onto(into, key, held);
      }
    },
    loaded() {
      loading = false;
    },
    take(key) {
      const said = byCase.get(key) ?? [];
      byCase.delete(key);
      seenReads.delete(key);
      if (!reads) return { said };
      const own = readByCase.get(key) ?? [];
      readByCase.delete(key);
      // A case's own read of a value the file read as it loaded wins, as the
      // narrowest level does in the native fold.
      const ownKeys = new Set(own.map(([name, value]) => JSON.stringify([name, value])));
      const loaded = atLoad.filter(([name, value]) => !ownKeys.has(JSON.stringify([name, value])));
      return { said, read: firstOfEach([...loaded, ...own]) };
    },
    held: (key) => [...(byCase.get(key) ?? [])],
    finish() {
      byCase.clear();
      readByCase.clear();
      pending.clear();
      pendingRead.clear();
      seenReads.clear();
      atLoad.length = 0;
      warned.clear();
    },
  };
}

/**
 * A call's record as `dimension:key` names to JSON text, or nothing when the
 * call is not a dimension and one record of keys.
 */
function entriesOf(dimension: unknown, record: unknown): readonly (readonly [string, string | null])[] | undefined {
  if (!isDimension(dimension) || record === null || typeof record !== 'object' || Array.isArray(record)) return undefined;
  const entries: (readonly [string, string | null])[] = [];
  for (const [key, held] of Object.entries(record as Record<string, unknown>)) {
    if (key === '') return undefined;
    entries.push([`${dimension}:${key}`, jsonText(held)]);
  }
  return entries;
}

function isDimension(dimension: unknown): dimension is string {
  return typeof dimension === 'string' && dimension !== '' && !dimension.includes(':');
}

/** A read's name: `dimension:key`, or under {@link MISUSED} the two it was handed when they make no name. */
function readName(dimension: unknown, key: unknown): string {
  return isDimension(dimension) && typeof key === 'string' ? `${dimension}:${key}` : `${MISUSED}${String(dimension)}:${String(key)}`;
}

/**
 * A value as JSON text, or `null` where JSON cannot hold it: a function, a
 * symbol, a bigint, `undefined`, a number that is not finite, or a cycle,
 * anywhere in it. Nothing is dropped the way `JSON.stringify` drops a function
 * property.
 */
function jsonText(value: unknown): string | null {
  try {
    return JSON.stringify(value, (_key, held: unknown) => {
      if (held === undefined || typeof held === 'function' || typeof held === 'symbol' || typeof held === 'bigint') {
        throw new TypeError('unrecorded');
      }
      if (typeof held === 'number' && !Number.isFinite(held)) throw new TypeError('unrecorded');
      return held;
    });
  } catch {
    return null;
  }
}

/** Reads, each `(name, value)` once, at the first site it was read at. */
function firstOfEach(read: readonly Said[]): Said[] {
  const seen = new Set<string>();
  return read.filter(([name, value]) => {
    const key = JSON.stringify([name, value]);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
 * A packed case coordinate carrying what the case heard, as its sixth field.
 *
 * Set at its index, as `case-owner.cts` sets every field after the
 * coordinate, so the project after it stays where its reader looks. The field
 * is always JSON, `{"said": […], "read": […]}`: an empty facet is a case that
 * said, or read, nothing under a recorder that was listening; a facet absent,
 * or the field empty or missing, is one nobody listened to, which a reader may
 * not take for a case that said or read nothing.
 */
const HEARD_FIELD = 5;

function packHeard(packed: string, heard: Heard): string {
  const fields = packed.split('\u0000');
  while (fields.length <= HEARD_FIELD) fields.push('');
  fields[HEARD_FIELD] = JSON.stringify(heard.read === undefined ? { said: heard.said } : { said: heard.said, read: heard.read });
  return fields.join('\u0000');
}

/** A frame owner's sixth field, as the realm wrote it; absent where its writer never listened. */
function heardField(packed: string): string | undefined {
  const field = packed.split('\u0000')[HEARD_FIELD];
  return field === undefined || field === '' ? undefined : field;
}

export = { PRECONDITION, BREADCRUMB, MISPLACED, MISUSED, CASE_LEVEL, recorder, entriesOf, jsonText, siteOf, packHeard, heardField };
