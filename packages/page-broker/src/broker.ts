// compass: variance-authority.harness
import type { Elsewhere, Query, Surface, Target } from './surface.js';

/**
 * The outcome of an action after which the broker is where it was: it is still
 * on the page once the page is quiet, nothing it declares arrived, and the app
 * did not open another page or a modal dialog. It does not say the page is
 * unchanged within it.
 */
export const stay: unique symbol = Symbol('stay');

/** How long the app has, and how long the page must be quiet. Not part of what a test declares. */
export interface Means {
  /** How long the app has, after the act, to reach an outcome or go quiet, in ms. */
  readonly timeout: number;
  /** How long nothing may be pending before the page is quiet, in ms. */
  readonly quiet: number;
}

/** What a member does to the page. Arguments after the surface are the test's. */
export type Act<Args extends readonly unknown[] = never[], R = unknown> = (on: Surface, ...args: Args) => Promise<R>;

/** An action's outcomes by name: a broker the app arrives at, or {@link stay}. */
export type Outcomes = Readonly<Record<string, AnyBroker | typeof stay>>;

/** A member that leads somewhere: the outcomes it can end in, and the act. */
export interface Leads<To extends Outcomes = Outcomes, Args extends readonly unknown[] = never[]> {
  readonly to: To;
  readonly act: Act<Args>;
  readonly means: Means;
}

/**
 * A broker's members: each acts or reads within it and decides nothing, or
 * {@link leads} somewhere the app's answer decides.
 */
// biome-ignore lint/suspicious/noExplicitAny: a member's own arguments are its declaration's
export type Members = Readonly<Record<string, Leads<Outcomes, any> | ((on: Surface, ...args: any) => Promise<unknown>)>>;

/** A broker as data, read without a page: its probe, and where each action leads. */
export interface Declared {
  readonly name: string;
  readonly probe: Query;
  /** Per action, its outcomes by name, each the broker's name it leads to or {@link stay}. */
  readonly leads: Readonly<Record<string, Readonly<Record<string, string | typeof stay>>>>;
}

/**
 * One complex part of the app — a checkout form, a combobox, a dialog — as a
 * test reaches it: how a person finds it, what can be done in it, and where
 * each action can lead.
 */
export interface Broker<Name extends string = string, M extends Members = Members> {
  readonly name: Name;
  readonly probe: Query;
  readonly members: M;
  readonly declared: Declared;
  /** The broker on the surface, or {@link Unreached} with reason `start` when its probe is not visible. */
  on<Handle>(surface: Surface<unknown, Handle>): Promise<Bound<Broker<Name, M>, Handle>>;
}

// biome-ignore lint/suspicious/noExplicitAny: any broker, whatever its members
type AnyBroker = Broker<string, any>;

/** A broker found on a surface: `root` is what the surface found, and each member is bound to the surface. */
export type Bound<B, Handle> =
  B extends Broker<string, infer M>
    ? { readonly root: Handle } & {
        readonly [K in keyof M]: M[K] extends Leads<infer To, infer Args>
          ? (...args: Args) => Reaching<To, B, Handle>
          : M[K] extends (on: Surface, ...args: infer Args) => infer R
            ? (...args: Args) => R
            : never;
      }
    : never;

/** Where an outcome leaves the test: in the broker arrived at, or, for {@link stay}, in the one it started in. */
type Arrived<T, Self, Handle> = T extends typeof stay ? Bound<Self, Handle> : Bound<T, Handle>;

/** Where an action ended: the outcome's name, and the broker the test is now in. */
export type Reached<To extends Outcomes, Self, Handle> = {
  [K in keyof To & string]: { readonly outcome: K; readonly at: Arrived<To[K], Self, Handle> };
}[keyof To & string];

/** A started action: await it for the outcome reached, or insist on one with `to`. */
export interface Reaching<To extends Outcomes, Self, Handle> extends Promise<Reached<To, Self, Handle>> {
  /** The broker arrived at, or `expected <name>, reached <other>` unless the action ended at `name`. */
  to<K extends keyof To & string>(name: K): Promise<Arrived<To[K], Self, Handle>>;
}

/**
 * Why an action did not end where it should: it was not where it starts, or an
 * outcome was there before it; it ended at another outcome than the one
 * insisted on, at two at once, somewhere undeclared, at none in time, or with
 * the page still busy when time ran out.
 */
export type Reason = 'start' | 'expected' | 'both' | 'elsewhere' | 'late' | 'unquiet';

/** A broker not on the page, or an action that did not end at an outcome it declares, or not at the one insisted on. */
export class Unreached extends Error {
  override readonly name = 'Unreached';
  constructor(
    message: string,
    /** `broker.action`, or the broker's name alone when it was not found. */
    readonly action: string,
    /** The outcomes the action declares. */
    readonly outcomes: readonly string[],
    readonly reason: Reason,
    /** Where the app went instead, or what kept it busy, in words, when that is known. */
    readonly went?: string,
  ) {
    super(message);
  }
}

/** Declares a member that leads somewhere, with other means than the default. */
export function by(means: Means) {
  return <const To extends Outcomes, Args extends readonly unknown[] = []>(
    to: To,
    act: Act<Args>,
  ): Leads<To, Args> => {
    if (Object.keys(to).length === 0) throw new Error('leads: declares no outcome');
    return { to, act, means };
  };
}

/**
 * Declares a member that leads somewhere: its outcomes by name — a broker, or
 * {@link stay} — and the act. The app has 5000 ms after the act to reach one,
 * and is quiet once nothing has been pending for 500 ms.
 *
 * @example
 * submit: leads({ payment: Payment, signIn: SignIn, invalid: stay }, (on) => on.click({ role: 'button', name: 'Continue' }))
 */
export const leads = by({ timeout: 5000, quiet: 500 });

/**
 * Declares a broker: its name, the query a person would find it by, and its
 * members. Read it as data with `declared`; reach it on a page with `on`.
 *
 * @example
 * const Billing = broker('billing', { probe: { role: 'form', name: 'Billing' }, actions: { submit } });
 * await (await Billing.on(surface(page))).submit().to('payment');
 */
export function broker<const Name extends string, const M extends Members = Record<never, never>>(
  name: Name,
  declaration: { readonly probe: Query; readonly actions?: M },
): Broker<Name, M> {
  const members = (declaration.actions ?? {}) as M;
  if ('root' in members) throw new Error(`${name}: root is what the surface found, and names no member`);
  const declared: Declared = {
    name,
    probe: declaration.probe,
    leads: Object.fromEntries(
      Object.entries(members).flatMap(([member, value]) =>
        typeof value === 'function'
          ? []
          : [[member, Object.fromEntries(Object.entries(value.to).map(([key, to]) => [key, to === stay ? stay : to.name]))]],
      ),
    ),
  };
  const self: Broker<Name, M> = {
    name,
    probe: declaration.probe,
    members,
    declared,
    async on<Handle>(surface: Surface<unknown, Handle>) {
      const root = await surface.find(declaration.probe).visible();
      if (root === undefined) throw new Unreached(`${name}: not on the page`, name, [], 'start');
      return bind(self, surface, root);
    },
  };
  return self;
}

function bind<Handle>(broker: AnyBroker, surface: Surface<unknown, Handle>, root: Handle): never {
  const bound: Record<string, unknown> = { root };
  for (const [member, value] of Object.entries(broker.members as Members)) {
    bound[member] =
      typeof value === 'function'
        ? (...args: unknown[]) => value(surface, ...args)
        : (...args: unknown[]) => reaching(broker, `${broker.name}.${member}`, value, surface, args);
  }
  return bound as never;
}

function reaching<Handle>(
  self: AnyBroker,
  action: string,
  leads: Leads,
  surface: Surface<unknown, Handle>,
  args: readonly unknown[],
): Promise<{ outcome: string; at: unknown }> & { to(name: string): Promise<unknown> } {
  const reached = perform(self, action, leads, surface, () => leads.act(surface, ...(args as never[])));
  const to = async (insisted: string): Promise<unknown> => {
    const { outcome, at } = await reached;
    if (outcome !== insisted) {
      throw new Unreached(`${action}: expected ${insisted}, reached ${outcome}`, action, Object.keys(leads.to), 'expected', outcome);
    }
    return at;
  };
  return Object.assign(reached, { to });
}

async function perform<Handle>(
  self: AnyBroker,
  action: string,
  { to, means }: Leads,
  surface: Surface<unknown, Handle>,
  act: () => Promise<unknown>,
): Promise<{ outcome: string; at: unknown }> {
  const names = Object.keys(to);
  const fail = (message: string, reason: Reason, went?: string): Unreached =>
    new Unreached(`${action}: ${message}`, action, names, reason, went);
  const staying = names.find((each) => to[each] === stay);
  const parts = names.flatMap((each) => {
    const outcome = to[each];
    return outcome === undefined || outcome === stay ? [] : [{ name: each, broker: outcome, target: surface.find(outcome.probe) }];
  });
  const look = async (among: typeof parts): Promise<{ part: (typeof parts)[number]; at: Handle }[]> => {
    const seen = await Promise.all(among.map((part) => part.target.visible()));
    return among.flatMap((part, index) => {
      const at = seen[index];
      return at === undefined ? [] : [{ part, at }];
    });
  };
  const home = surface.find(self.probe);

  if ((await home.visible()) === undefined) throw fail(`starts from ${self.name}, and it is not on the page`, 'start');
  // An outcome already on the page is never arrived at: whatever the act does,
  // its being there would read as the answer.
  const before = await look(parts);
  if (before.length > 0) {
    const there = before.map(({ part }) => part.broker.name);
    const many = there.length > 1;
    throw fail(
      `${there.join(' and ')} ${many ? 'are' : 'is'} on the page before the action, so ${many ? 'they' : 'it'} could not be arrived at`,
      'start',
    );
  }

  const none = (then: string): string =>
    parts.length === 0 ? '' : `reached none of ${parts.map((part) => part.name).join(', ')}${then}`;
  const quiet = surface.quiet(means.quiet);
  let gone: Elsewhere | undefined;
  let out: ReturnType<typeof setTimeout> | undefined;
  const answered = new AbortController();
  // Set once the page was quiet without the broker the action stays in: staying is then not the answer.
  let left = false;
  try {
    gone = await surface.elsewhere();
    await act();
    // A deadline that names the outcomes never reached, never a wait. The app's
    // time starts when the act is done: a slow act does not spend it.
    const deadline = Date.now() + means.timeout;
    const late = new Promise<'late'>((resolve) => {
      out = setTimeout(() => resolve('late'), means.timeout);
    });
    const targets: readonly Target<Handle>[] = parts.map((part) => part.target);
    // An action that cannot stay still hears the first quiet, to tell an app
    // gone somewhere undeclared; quiet anywhere else is no answer to it.
    let hearing = true;
    // One wait for an arrival at a time, kept across a quiet that woke first,
    // and ended when the action answers.
    let arrival: Promise<'arrived' | 'late'> | undefined;
    for (;;) {
      const waits: Promise<'arrived' | 'late' | 'quiet'>[] = [late];
      if (targets.length > 0) {
        arrival ??= surface.arrival(targets, deadline - Date.now(), answered.signal);
        // A wait ended after the action answered has nobody left to tell.
        arrival.catch(() => undefined);
        waits.push(arrival);
      }
      // Asked for again on every pass: a quiet that ended before an arrival
      // woke the wait says nothing of what has begun since.
      if (staying !== undefined || hearing) waits.push(quiet.settled());
      const woke = await Promise.race(waits);
      if (woke === 'late') break;
      if (woke === 'arrived') arrival = undefined;
      const arrived = await look(parts);
      if (arrived.length > 1) {
        const both = arrived.map(({ part }) => part.name).join(' and ');
        throw fail(`reached ${both} at once, so its outcomes are not told apart`, 'both', both);
      }
      if (arrived[0] !== undefined) {
        const { part, at } = arrived[0];
        return { outcome: part.name, at: bind(part.broker, surface, at) };
      }
      if (woke !== 'quiet') continue;
      const still = staying === undefined ? undefined : await home.visible();
      const went = await gone.left();
      // What began while the page was looked at ended the quiet it was looked at in.
      if (!quiet.still()) continue;
      // A new address that still shows the broker is staying; anywhere else,
      // quiet is not staying: no outcome says where the app is.
      if (went !== undefined && !(still !== undefined && went.by === 'address')) {
        throw fail(`${none(', and ')}${went.words}, which no outcome declares`, 'elsewhere', went.words);
      }
      hearing = false;
      if (staying !== undefined && still !== undefined) return { outcome: staying, at: bind(self, surface, still) };
      // The broker it would stay in has gone and nothing has arrived: the answer is not in.
      left = staying !== undefined;
    }
    // Time running out is never staying: with work still pending, the answer is not in.
    const went = await gone.left();
    if (went !== undefined) throw fail(`${none(', and ')}${went.words}, which no outcome declares`, 'elsewhere', went.words);
    const held = quiet.held();
    if (staying === undefined || (held === undefined && quiet.still())) {
      const unreached = left
        ? `${self.name} left the page, and ${parts.length === 0 ? 'nothing declared took its place' : none('')}`
        : none('');
      throw fail(`${unreached} within ${means.timeout} ms`, 'late');
    }
    throw fail(
      `${none(' and ')}the page did not go quiet within ${means.timeout} ms${held === undefined ? '' : `: ${held}`}`,
      'unquiet',
      held,
    );
  } finally {
    answered.abort();
    clearTimeout(out);
    quiet.stop();
    gone?.stop();
  }
}
