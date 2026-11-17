// A broker between a test and the page: fragments are the only states a test
// may stand in, every action departs, settles and arrives, and a handle is
// revoked the moment the fragment it names is left.
//
// A prototype. It runs on Playwright only; the driver and read driver are the
// seam another runner would fill.
import type { Locator, Page } from '@playwright/test';
import { settle, type Signals } from './settle.js';

// ── where: a selector is data, so a probe can be listed, printed and compared ──

export type Where =
  | { readonly by: 'role'; readonly role: string; readonly name?: string }
  | { readonly by: 'label'; readonly text: string }
  | { readonly by: 'testId'; readonly id: string };

export const byRole = (role: string, name?: string): Where => ({ by: 'role', role, name });
export const byLabel = (text: string): Where => ({ by: 'label', text });
export const byTestId = (id: string): Where => ({ by: 'testId', id });

const spell = (where: Where): string =>
  where.by === 'role'
    ? `${where.role}${where.name === undefined ? '' : ` "${where.name}"`}`
    : where.by === 'label'
      ? `label "${where.text}"`
      : `testId "${where.id}"`;

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

interface Spec {
  readonly probe: Where;
  readonly uses?: Record<string, AnyFragment>;
  readonly actions?: Record<string, Act | Stays | Leads>;
  readonly reads?: Record<string, Read>;
}

export interface Fragment<S extends Spec = Spec> {
  readonly name: string;
  readonly spec: S;
}
type AnyFragment = Fragment<any>;

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

// ── the journal: what the test walked, as declared edges ──

export interface Step {
  readonly from: string;
  readonly action: string;
  readonly kind: 'stay' | 'lead' | 'raw';
  /** The outcome the test named; undefined when it went exploring. */
  readonly named?: string;
  readonly to: string;
}

class Revoked extends Error {}

interface State {
  status: 'live' | 'covered' | 'departed';
  /** Who covers it, or the action it departed at. */
  why?: string;
}

/** One test's session with the app. */
export class App {
  readonly journal: Step[] = [];
  private readonly states = new Map<object, State>();
  /** A cover's handle, and what it covers. */
  private readonly covered = new Map<object, { fragment: AnyFragment; handle: object; state: State }>();

  constructor(
    readonly page: Page,
    private readonly signals: Signals = {},
  ) {}

  /** Settles, then requires the fragment to be what the page shows. */
  async enter<F extends AnyFragment>(fragment: F): Promise<Handle<F>> {
    await settle(this.page, this.signals);
    const found = await this.sense();
    if (!found.includes(fragment.name)) {
      throw new Error(`entered expecting ${fragment.name}, the page shows ${list(found)}`);
    }
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

  private handle<F extends AnyFragment>(fragment: F, within: Page | Locator, shared?: State): Handle<F> {
    const region = locate(within, fragment.spec.probe).first();
    const state: State = shared ?? { status: 'live' };
    const meta: Meta = { fragment, region, state };
    const self: Record<string | symbol, unknown> = { [META]: meta };
    this.states.set(self, state);

    const guard = (action: string, acting: boolean) => {
      if (state.status === 'departed') {
        throw new Revoked(`${fragment.name} departed at ${state.why}; ${action} has nothing to act on`);
      }
      if (acting && state.status === 'covered') {
        throw new Revoked(`${fragment.name} is covered by ${state.why}; ${action} would act under it`);
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
      self[name] = this.handle(child, this.page, state);
    }

    const actions = Object.entries((fragment.spec as Spec).actions ?? {});
    const run = async (name: string, args: unknown[]): Promise<unknown> => {
      guard(name, true);
      const declared = actions.find(([key]) => key === name)![1];
      if (typeof declared === 'function' || declared.kind === 'stays') {
        await this.stayed(fragment, region, name, declared, args);
        return self;
      }
      return this.lead(fragment, self, state, name, declared, args);
    };

    // A chain queues calls on one promise, so `form.country('NL').street('x')` reads
    // as a sentence and still runs one action at a time.
    const chain = (pending: Promise<unknown>): Record<string, unknown> => {
      const link: Record<string, unknown> = {
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
    if (!(await this.shows(fragment))) {
      throw new Error(`${fragment.name}.${name} is declared to stay, and left: the page shows ${list(await this.sense())}`);
    }
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

    // Arrival: a declared destination that shows wins over staying, since the
    // departed region may linger beneath a dialog or during an exit.
    const shown = await this.sense();
    const under = this.covered.get(self);
    const entries = Object.entries(declared.outcomes).map(
      ([key, to]) =>
        [key, to === back ? under?.fragment : typeof to === 'object' && 'cover' in to ? to.cover : to] as const,
    );
    const covering = (key: string) => {
      const to = declared.outcomes[key];
      return typeof to === 'object' && 'cover' in to;
    };
    const moved = entries.find(([, to]) => to !== stay && to !== undefined && shown.includes((to as AnyFragment).name));
    const stayed = entries.find(([, to]) => to === stay);
    const arrived = moved ?? (stayed !== undefined && shown.includes(fragment.name) ? stayed : undefined);
    if (arrived === undefined) {
      throw new Error(
        `${fragment.name}.${name} declares ${list(entries.map(([key]) => key))}, and the page shows ${list(shown)}`,
      );
    }
    const [outcome, to] = arrived;
    if (named !== undefined && outcome !== named) {
      throw new Error(`${fragment.name}.${name} was expected to reach ${named}, and reached ${outcome} (${list(shown)})`);
    }
    const toName = to === stay ? fragment.name : (to as AnyFragment).name;
    this.journal.push({ from: fragment.name, action: name, kind: 'lead', named, to: toName });

    let handle: object;
    if (to === stay) {
      handle = self;
    } else if (under !== undefined && under.fragment === to) {
      // Leaving a cover for what it covered returns the covered handle, live again.
      state.status = 'departed';
      state.why = `${fragment.name}.${name}`;
      under.state.status = 'live';
      under.state.why = undefined;
      handle = under.handle;
    } else {
      const next = to as AnyFragment;
      if (covering(outcome)) {
        state.status = 'covered';
        state.why = next.name;
      } else {
        this.depart(name, fragment.name);
      }
      handle = this.handle(next, this.page);
      if (covering(outcome)) this.covered.set(handle, { fragment, handle: self, state });
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
  readonly region: Locator;
  readonly state: State;
}

const list = (names: readonly string[]) => (names.length === 0 ? 'nothing' : names.join(', '));

/** Two journals side by side, from the first step where they part. */
export function fork(a: readonly Step[], b: readonly Step[]): string {
  const line = (step: Step | undefined) =>
    step === undefined ? '(ended)' : `${step.from}.${step.action} → ${step.to}${step.named === undefined && step.kind === 'lead' ? ' (unnamed)' : ''}`;
  let at = 0;
  while (at < Math.max(a.length, b.length) && line(a[at]) === line(b[at])) at += 1;
  if (at === Math.max(a.length, b.length)) return 'the same walk';
  const shared = a.slice(0, at).map(line);
  return [
    `shared: ${shared.length === 0 ? '(nothing)' : shared.join('  ·  ')}`,
    `a: ${a.slice(at).map(line).join('  ·  ') || '(ended)'}`,
    `b: ${b.slice(at).map(line).join('  ·  ') || '(ended)'}`,
  ].join('\n');
}
