// A broker between a test and the page: fragments are the only states a test
// may stand in, every action departs, settles and arrives, and a handle is
// revoked the moment the fragment it names is left.
//
// A prototype. It runs on Playwright only; the driver and read driver are the
// seam another runner would fill.
import type { Locator, Page } from '@playwright/test';
import { settle, type Signals } from './settle.js';
import type { Step } from './journal.js';

// ── where: a selector is data, so a probe can be listed, printed and compared ──

export type Where =
  | { readonly by: 'role'; readonly role: string; readonly name?: string }
  | { readonly by: 'label'; readonly text: string }
  | { readonly by: 'testId'; readonly id: string };

export const byRole = (role: string, name?: string): Where => ({ by: 'role', role, name });
export const byLabel = (text: string): Where => ({ by: 'label', text });
export const byTestId = (id: string): Where => ({ by: 'testId', id });

function locate(scope: Page | Locator, where: Where): Locator {
  if (where.by === 'role') {
    return scope.getByRole(where.role as Parameters<Page['getByRole']>[0], {
      name: where.name,
      exact: true,
    });
  }
  return where.by === 'label' ? scope.getByLabel(where.text, { exact: true }) : scope.getByTestId(where.id);
}

// ── drivers: an action gets hands, a read gets eyes only ──

export interface ReadDriver {
  text(where: Where): Promise<string>;
  texts(where: Where): Promise<string[]>;
  number(where: Where): Promise<number>;
  count(where: Where): Promise<number>;
  value(where: Where): Promise<string>;
}

export interface Driver extends ReadDriver {
  click(where: Where): Promise<void>;
  fill(where: Where, value: string): Promise<void>;
  select(where: Where, value: string): Promise<void>;
  press(where: Where, key: string): Promise<void>;
}

// Actions run against an arrived, settled region, so they never wait for one:
// a missing element is a broken contract, said at once.
const NOW = { timeout: 1_000 };

function readDriver(scope: Locator): ReadDriver {
  const at = (where: Where) => locate(scope, where);
  return {
    text: async (where) => (await at(where).innerText(NOW)).trim(),
    texts: async (where) => (await at(where).allInnerTexts()).map((text) => text.trim()),
    number: async (where) => Number((await at(where).innerText(NOW)).trim()),
    count: (where) => at(where).count(),
    value: (where) => at(where).inputValue(NOW),
  };
}

function driver(scope: Locator): Driver {
  const at = (where: Where) => locate(scope, where);
  return {
    ...readDriver(scope),
    click: (where) => at(where).click(NOW),
    fill: (where, value) => at(where).fill(value, NOW),
    select: async (where, value) => {
      await at(where).selectOption(value, NOW);
    },
    press: (where, key) => at(where).press(key, NOW),
  };
}

// ── the contract ──

type Act = (d: Driver, ...args: any[]) => Promise<unknown>;
type Read = (r: ReadDriver, ...args: any[]) => Promise<unknown>;

/** The action leaves the fragment where it is; this is the default. */
export const stay = Symbol('stay');
/** The action closes a fragment that arrived `over` another, returning to what it covered. */
export const back = Symbol('back');

/**
 * The outcome opens over the departing fragment instead of replacing it: the
 * covered handle may still be read, and acts again once the cover goes `back`.
 * Covering is the edge's, not the dialog's: one dialog can cover many pages.
 */
export interface Over<F extends AnyFragment = AnyFragment> {
  readonly cover: F;
}
export const over = <F extends AnyFragment>(cover: F): Over<F> => ({ cover });

export interface Stays<A extends Act = Act> {
  readonly kind: 'stays';
  readonly act: A;
  /** Holds the action open until the app says its effect landed. */
  readonly until?: Until;
}
export interface Leads<O extends Outcomes = Outcomes, A extends Act = Act> {
  readonly kind: 'leads';
  readonly outcomes: O;
  readonly act: A;
}
export type Outcomes = Record<string, AnyFragment | Over | typeof stay | typeof back>;

/** A value read before the action, and the condition on it the action waits for. */
export interface Until {
  readonly read: Read;
  readonly done: (before: unknown, now: unknown) => boolean;
}
export const changed = (read: Read): Until => ({ read, done: (before, now) => before !== now });

export const stays = <A extends Act>(act: A, options: { until?: Until } = {}): Stays<A> => ({
  kind: 'stays',
  act,
  until: options.until,
});
export const leads = <O extends Outcomes, A extends Act>(outcomes: O, act: A): Leads<O, A> => ({
  kind: 'leads',
  outcomes,
  act,
});

export interface Spec {
  readonly probe: Where;
  readonly uses?: Record<string, AnyFragment>;
  readonly actions?: Record<string, Act | Stays | Leads>;
  readonly reads?: Record<string, Read>;
}

export interface Fragment<S extends Spec = Spec> {
  readonly name: string;
  readonly spec: S;
}
export type AnyFragment = Fragment<any>;

const registry: AnyFragment[] = [];

export function fragment<const S extends Spec>(name: string, spec: S): Fragment<S> {
  // One namespace on the handle: a read and an action under one name would leave
  // the test calling whichever was assigned last.
  const names = [spec.actions, spec.reads, spec.uses].flatMap((part) => Object.keys(part ?? {}));
  const twice = names.filter((each, at) => names.indexOf(each) !== at);
  if (twice.length > 0) throw new Error(`${name} declares ${twice.join(', ')} twice`);
  const made = { name, spec };
  registry.push(made);
  return made;
}

// ── handles: the test's view of one arrived fragment ──

type Rest<F> = F extends (d: any, ...args: infer P) => any ? P : never;
type Arrived<F, O> = O extends typeof stay
  ? Handle<F>
  : O extends typeof back
    ? Handle<AnyFragment>
    : O extends Over<infer C>
      ? Handle<C>
      : Handle<O>;

type Actions<F> = { [K in StayKeys<F>]: (...args: Rest<ActOf<F, K>>) => Chain<F> } & {
  [K in LeadKeys<F>]: LeadCall<F, K>;
};
type Chain<F> = Actions<F> & PromiseLike<Handle<F>>;

type SpecOf<F> = F extends Fragment<infer S> ? S : never;
type ActionsOf<F> = NonNullable<SpecOf<F>['actions']>;
type ActOf<F, K> = K extends keyof ActionsOf<F>
  ? ActionsOf<F>[K] extends { act: infer A }
    ? A
    : ActionsOf<F>[K]
  : never;
type StayKeys<F> = {
  [K in keyof ActionsOf<F>]: ActionsOf<F>[K] extends Leads ? never : K;
}[keyof ActionsOf<F>];
type LeadKeys<F> = {
  [K in keyof ActionsOf<F>]: ActionsOf<F>[K] extends Leads ? K : never;
}[keyof ActionsOf<F>];
type OutcomesOf<F, K> = K extends keyof ActionsOf<F>
  ? ActionsOf<F>[K] extends Leads<infer O> ? O : never
  : never;

interface LeadCall<F, K> {
  /** Exploratory: goes wherever the app goes. The journal marks the step unnamed. */
  (...args: Rest<ActOf<F, K>>): Promise<Arrival<F, OutcomesOf<F, K>>>;
  /** The test names the branch; any other arrival fails, naming what it found. */
  to<N extends keyof OutcomesOf<F, K> & string>(
    outcome: N,
    ...args: Rest<ActOf<F, K>>
  ): Promise<Arrived<F, OutcomesOf<F, K>[N]>>;
}
type Arrival<F, O> = {
  [N in keyof O]: { readonly outcome: N; readonly handle: Arrived<F, O[N]> };
}[keyof O];

export type Handle<F> = Actions<F> & {
  readonly [K in keyof NonNullable<SpecOf<F>['reads']>]: (
    ...args: Rest<NonNullable<SpecOf<F>['reads']>[K]>
  ) => Promise<Awaited<ReturnType<NonNullable<SpecOf<F>['reads']>[K]>>>;
} & {
  readonly [K in keyof NonNullable<SpecOf<F>['uses']>]: Handle<NonNullable<SpecOf<F>['uses']>[K]>;
} & { readonly [Symbol.asyncDispose]: () => Promise<void> };

class Revoked extends Error {}

interface State {
  status: 'live' | 'covered' | 'departed';
  /** Who covers it, or the action it departed at. */
  why?: string;
  /** The document it was last seen on; another one means it went with the old. */
  doc: number;
  /** The lifecycle it joined when its fragment, entered alone, turned out to be a part. */
  follows?: State;
}

const own = (state: State): State => (state.follows === undefined ? state : own(state.follows));

/** One test's session with the app. */
export class App {
  readonly journal: Step[] = [];
  private readonly states = new Map<object, State>();
  /** A cover's handle, and what it covers. */
  private readonly covered = new Map<State, { fragment: AnyFragment; handle: object; state: State }>();
  /** The one handle each fragment has: a fragment on the page has one lifecycle, however it is reached. */
  private readonly roots = new Map<AnyFragment, object>();
  /** Main-frame navigations so far; each one is a new document. */
  private doc = 0;

  constructor(
    readonly page: Page,
    private readonly signals: Signals = {},
  ) {
    page.on('framenavigated', (frame) => {
      if (frame === page.mainFrame()) this.doc += 1;
    });
  }

  /** Whether a state outlived every navigation since the broker last saw it; one that did not departs. */
  private alive(shared: State): boolean {
    const state = own(shared);
    if (state.status !== 'departed' && state.doc !== this.doc) {
      state.status = 'departed';
      state.why = 'a navigation the broker did not take';
    }
    return state.status !== 'departed';
  }

  /** Settles, then requires the fragment to be what the page shows. */
  async enter<F extends AnyFragment>(fragment: F): Promise<Handle<F>> {
    await settle(this.page, this.signals);
    const found = await this.sense();
    if (!found.includes(fragment.name)) {
      throw new Error(`entered expecting ${fragment.name}, the page shows ${list(found)}`);
    }
    const existing = this.roots.get(fragment);
    if (existing !== undefined && this.alive(this.states.get(existing)!)) return existing as Handle<F>;
    return this.handle(fragment, this.page.locator(':root'));
  }

  /** Every registered fragment the page shows now, a dialog before what it covers. */
  async sense(): Promise<string[]> {
    const shown: string[] = [];
    for (const each of registry) {
      if (await this.shows(each)) shown.push(each.name);
    }
    return shown;
  }

  /** The escape hatch: the region's locator, and a line in the journal saying so. */
  raw(handle: { readonly [K: symbol]: unknown }): Locator {
    const meta = (handle as any)[META] as Meta;
    this.journal.push({ from: meta.fragment.name, action: 'raw', kind: 'raw', to: meta.fragment.name });
    return meta.region;
  }

  private async shows(fragment: AnyFragment): Promise<boolean> {
    const found = locate(this.page, fragment.spec.probe);
    return (await found.count()) > 0 && (await found.first().isVisible());
  }

  private handle<F extends AnyFragment>(
    fragment: F,
    within: Page | Locator,
    shared?: { state: State; owner: AnyFragment },
  ): Handle<F> {
    const region = locate(within, fragment.spec.probe).first();
    const state: State = shared?.state ?? { status: 'live', doc: this.doc };
    const owner = shared?.owner ?? fragment;
    // The same fragment entered alone earlier joins this lifecycle: one fragment, one lifecycle.
    const prior = (this.roots.get(fragment) as any)?.[META] as Meta | undefined;
    if (shared && prior?.owner === fragment && prior.state.follows === undefined && this.alive(prior.state)) prior.state.follows = state;
    const meta: Meta = { fragment, owner, region, state };
    const self: Record<string | symbol, unknown> = { [META]: meta };
    this.states.set(self, state);
    // The latest handle is the one alive: any earlier one for this fragment departed or is covered with its owner.
    this.roots.set(fragment, self);

    const guard = (action: string, acting: boolean) => {
      if (!this.alive(state)) {
        throw new Revoked(`${fragment.name} departed at ${own(state).why}; ${action} has nothing to act on`);
      }
      if (acting && own(state).status === 'covered') {
        throw new Revoked(`${fragment.name} is covered by ${own(state).why}; ${action} would act under it`);
      }
    };

    for (const [name, read] of Object.entries((fragment.spec as Spec).reads ?? {})) {
      self[name] = async (...args: unknown[]) => {
        guard(name, false);
        return (read as Read)(readDriver(region), ...args);
      };
    }
    for (const [name, child] of Object.entries((fragment.spec as Spec).uses ?? {})) {
      // A part lives and dies with the fragment that uses it. It is found on the
      // page, not inside the region: a header is beside a form, not in it.
      self[name] = this.handle(child, this.page, { state, owner });
    }

    const actions = Object.entries((fragment.spec as Spec).actions ?? {});
    const run = async (name: string, args: unknown[]): Promise<unknown> => {
      guard(name, true);
      const declared = actions.find(([key]) => key === name)![1];
      if (typeof declared === 'function' || declared.kind === 'stays') {
        await this.stayed(fragment, owner, own(state), region, name, declared, args);
        return self;
      }
      return this.lead(fragment, self, own(state), name, declared, args);
    };

    // A chain queues calls on one promise, so `form.country('NL').street('x')` reads
    // as a sentence and still runs one action at a time.
    const chain = (pending: Promise<unknown>): Record<string, unknown> => {
      const link: Record<string, unknown> = {
        // The chain is awaited on purpose: awaiting it yields the handle.
        // oxlint-disable-next-line unicorn/no-thenable
        then: (resolve: any, reject: any) => pending.then(() => self).then(resolve, reject),
      };
      for (const [name, declared] of actions) {
        const isLead = typeof declared !== 'function' && declared.kind === 'leads';
        if (!isLead) {
          link[name] = (...args: unknown[]) => chain(pending.then(() => run(name, args)));
          continue;
        }
        const call = (...args: unknown[]) => pending.then(() => run(name, args));
        call.to = (outcome: string, ...args: unknown[]) =>
          pending.then(() => run(name, [NAMED, outcome, ...args]));
        link[name] = call;
      }
      return link;
    };
    const start = chain(Promise.resolve());
    for (const [name] of actions) self[name] = start[name];
    self[Symbol.asyncDispose] = () => settle(this.page, this.signals);
    return self as Handle<F>;
  }

  private async stayed(
    fragment: AnyFragment,
    owner: AnyFragment,
    state: State,
    region: Locator,
    name: string,
    declared: Act | Stays,
    args: unknown[],
  ): Promise<void> {
    const act = typeof declared === 'function' ? declared : declared.act;
    const until = typeof declared === 'function' ? undefined : declared.until;
    const before = until === undefined ? undefined : await until.read(readDriver(region));
    await act(driver(region), ...args);
    await settle(this.page, this.signals);
    if (until !== undefined) {
      const deadline = Date.now() + 10_000;
      while (!until.done(before, await until.read(readDriver(region)))) {
        if (Date.now() > deadline) throw new Error(`${fragment.name}.${name} never landed`);
        await settle(this.page, this.signals);
      }
    }
    // A part stays only if what owns it does: a header still showing says nothing of the form beside it.
    for (const each of new Set([fragment, owner])) {
      if (!(await this.shows(each))) {
        this.depart(name, fragment.name);
        const who = each === fragment ? '' : ` ${each.name}`;
        throw new Error(`${fragment.name}.${name} is declared to stay, and${who} left: the page shows ${list(await this.sense())}`);
      }
    }
    state.doc = this.doc;
    this.journal.push({ from: fragment.name, action: name, kind: 'stay', to: fragment.name });
  }

  private async lead(
    fragment: AnyFragment,
    self: object,
    state: State,
    name: string,
    declared: Leads,
    args: unknown[],
  ): Promise<unknown> {
    const named = args[0] === NAMED ? (args[1] as string) : undefined;
    const rest = named === undefined ? args : args.slice(2);
    if (named !== undefined && !(named in declared.outcomes)) {
      throw new Error(`${fragment.name}.${name} declares no outcome "${named}"; it declares ${list(Object.keys(declared.outcomes))}`);
    }
    const region = (self as any)[META].region as Locator;
    await declared.act(driver(region), ...rest);
    await settle(this.page, this.signals);

    // Arrival is witnessed from both ends, by one outcome. The destination shows;
    // what was left is gone, or still shows beneath a cover; and no second
    // declared outcome shows beside it, so the order of `leads` decides nothing.
    const shown = await this.sense();
    const under = this.covered.get(state);
    const { owner } = (self as any)[META] as Meta;
    const target = (to: Outcomes[string]): AnyFragment | undefined =>
      to === back ? under?.fragment : typeof to === 'object' && 'cover' in to ? to.cover : (to as AnyFragment);
    const keys = Object.keys(declared.outcomes);
    const reached = keys.filter((key) => {
      const to = declared.outcomes[key];
      const where = to === stay ? undefined : target(to);
      // What a cover covers shows beneath it all along: going back is witnessed by the cover gone.
      return where !== undefined && shown.includes(where.name) && !(to === back && shown.includes(owner.name));
    });
    if (reached.length > 1) {
      throw new Error(`${fragment.name}.${name} reached ${reached.join(' and ')} at once; the page shows ${list(shown)}`);
    }
    const staying = keys.find((key) => declared.outcomes[key] === stay);
    // A part stays only with its owner, as on a plain stay.
    const outcome = reached[0] ?? (staying !== undefined && shown.includes(fragment.name) && shown.includes(owner.name) ? staying : undefined);
    if (outcome === undefined) {
      if (!shown.includes(owner.name)) this.depart(name, fragment.name);
      if (under !== undefined && keys.some((key) => declared.outcomes[key] === back)) {
        throw new Error(`${fragment.name}.${name} went back to ${under.fragment.name}, and ${owner.name} still shows`);
      }
      throw new Error(`${fragment.name}.${name} declares ${list(keys)}, and the page shows ${list(shown)}`);
    }
    const declaredTo = declared.outcomes[outcome];
    const to = declaredTo === stay ? stay : target(declaredTo)!;
    const covering = (key: string) => typeof declared.outcomes[key] === 'object' && 'cover' in declared.outcomes[key];
    if (to !== stay) {
      const left = shown.includes(owner.name);
      if (covering(outcome) && !left) {
        throw new Error(`${fragment.name}.${name} reached ${to.name} over ${owner.name}, and ${owner.name} is gone`);
      }
      if (declaredTo !== back && !covering(outcome) && to !== owner && left) {
        throw new Error(`${fragment.name}.${name} reached ${to.name}, and ${owner.name} still shows; declare it over(${to.name})`);
      }
    }
    const toName = to === stay ? fragment.name : (to as AnyFragment).name;
    this.journal.push({ from: fragment.name, action: name, kind: 'lead', outcome, named, to: toName });

    let handle: object;
    if (to === stay) {
      state.doc = this.doc;
      handle = self;
    } else if (under !== undefined && under.fragment === to) {
      // Leaving a cover for what it covered returns the covered handle, live again.
      Object.assign(state, { status: 'departed', why: `${fragment.name}.${name}` });
      Object.assign(under.state, { status: 'live', why: undefined, doc: this.doc });
      handle = under.handle;
    } else {
      const next = to as AnyFragment;
      if (covering(outcome)) Object.assign(state, { status: 'covered', why: next.name, doc: this.doc });
      else this.depart(name, fragment.name);
      handle = this.handle(next, this.page);
      // What waits beneath is the owner, not the part that opened the cover.
      if (covering(outcome)) this.covered.set((handle as any)[META].state, { fragment: owner, handle: this.roots.get(owner) ?? self, state });
    }
    // A wrong branch is still the branch taken: the handles and the journal say so before the test fails.
    if (named !== undefined && outcome !== named) {
      throw new Error(`${fragment.name}.${name} was expected to reach ${named}, and reached ${outcome} (${list(shown)})`);
    }
    return named === undefined ? { outcome, handle } : handle;
  }

  /** Leaving a page revokes everything on it, the dialogs over it included. */
  private depart(action: string, from: string): void {
    for (const state of this.states.values()) {
      if (state.status !== 'departed') {
        state.status = 'departed';
        state.why = `${from}.${action}`;
      }
    }
  }
}

const META = Symbol('meta');
const NAMED = Symbol('named');
interface Meta {
  readonly fragment: AnyFragment;
  /** The fragment whose arrival made this handle: itself, or the one using it as a part. */
  readonly owner: AnyFragment;
  readonly region: Locator;
  readonly state: State;
}

const list = (names: readonly string[]) => (names.length === 0 ? 'nothing' : names.join(', '));
