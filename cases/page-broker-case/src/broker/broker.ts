// A broker between a test and the page: fragments are the only states a test
// may stand in, every action departs, settles and arrives, and a handle is
// revoked the moment the fragment it names is left.
//
// A prototype. It runs on Playwright only; the driver and read driver are the
// seam another runner would fill.
import type { Locator, Page, Request } from '@playwright/test';
import { settle, type Signals } from './settle.js';
import type { Step } from './journal.js';
import { driver, locate, readDriver } from './driver.js';
import { back, registry, stay, type Act, type AnyFragment, type Fragment, type Leads, type Outcomes, type Over, type Read, type Spec, type Stays } from './contract.js';

export { byLabel, byRole, byTestId, type Driver, type ReadDriver, type Where } from './driver.js';
export * from './contract.js';

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
}

/** One test's session with the app. */
export class App {
  readonly journal: Step[] = [];
  private readonly states = new Map<object, State>();
  /** What a cover covers: the whole page beneath it, so going back uncovers exactly that. */
  private readonly covered = new Map<State, { by: string; fragment: AnyFragment; handle: object; states: State[] }>();
  /** The one handle each fragment has: a fragment on the page has one lifecycle, however it is reached. */
  private readonly roots = new Map<AnyFragment, object>();
  /** Documents the main frame has loaded so far. */
  private doc = 0;
  /** The main frame's document request in flight: only a navigation that made one replaces the document. */
  private loading: Request | undefined;
  /** The main frame's origin: a document that changes it replaced the one before, with or without a request. */
  private origin: string | undefined;

  constructor(
    readonly page: Page,
    private readonly signals: Signals = {},
  ) {
    // A history push or a hash change navigates the frame and keeps its document, and every handle on it.
    page.on('request', (request) => {
      if (request.isNavigationRequest() && request.frame() === page.mainFrame()) this.loading = request;
    });
    const ended = (request: Request) => {
      if (request === this.loading) this.loading = undefined;
    };
    page.on('requestfinished', ended);
    page.on('requestfailed', ended);
    page.on('framenavigated', (frame) => {
      if (frame !== page.mainFrame()) return;
      const origin = new URL(frame.url()).origin;
      const moved = origin !== this.origin;
      this.origin = origin;
      if (this.loading === undefined && !moved) return;
      this.doc += 1;
      this.loading = undefined;
    });
  }

  /** Whether a state outlived every navigation since the broker last saw it; one that did not departs. */
  private alive(state: State): boolean {
    if (state.status !== 'departed' && state.doc !== this.doc) Object.assign(state, { status: 'departed', why: 'a navigation the broker did not take' });
    return state.status !== 'departed';
  }

  /** Settles, then requires the fragment to be what the page shows. */
  async enter<F extends AnyFragment>(fragment: F): Promise<Handle<F>> {
    await settle(this.page, this.signals);
    const found = await this.sense();
    if (!found.includes(fragment.name)) {
      throw new Error(`entered expecting ${fragment.name}, the page shows ${list(found)}`);
    }
    const missing = await this.missing(fragment);
    if (missing !== undefined) throw new Error(`entered expecting ${fragment.name}, and its part ${missing} is missing`);
    const existing = this.roots.get(fragment);
    if (existing !== undefined && this.alive(this.states.get(existing)!)) return existing as Handle<F>;
    const fresh = this.handle(fragment, this.page.locator(':root'));
    const state = (fresh as any)[META].state as State;
    // What uses an open cover lives and leaves with it, and so does every part only it holds.
    const tree = [fresh, ...this.within(fresh)];
    // Using the cover is reaching the cover itself, or a handle on it that answers to this tree alone; sharing one of its parts is not.
    const mine = new Set(tree.map((each) => ((each as any)[META] as Meta).fragment));
    const cover = tree
      .filter((each) => {
        const meta = (each as any)[META] as Meta;
        return this.covered.get(meta.state)?.by === meta.fragment.name || meta.owners.every((one) => mine.has(one));
      })
      .map((each) => (each as any)[META].state as State)
      .find((each) => this.covered.has(each) && this.alive(each));
    if (cover !== undefined) {
      for (const each of tree.filter((one) => (one as any)[META].state === state)) {
        (each as any)[META].state = cover;
        this.states.set(each, cover);
      }
      return fresh;
    }
    // A modal covers the whole page, what was entered beneath it after it opened included. It goes
    // beneath the first cover still open, so closing a cover above that one leaves it covered.
    const bottom = [...this.covered].find(([open]) => this.alive(open))?.[1];
    if (bottom !== undefined) {
      // A part a cover's owners hold, reached from the page too, waits beneath with the page: it acts only when every owner can.
      for (const each of tree) {
        const meta = (each as any)[META] as Meta;
        const open = this.covered.get(meta.state);
        if (open === undefined || open.by === meta.fragment.name || !this.alive(meta.state)) continue;
        meta.state = state;
        this.states.set(each, state);
      }
      Object.assign(state, { status: 'covered', why: bottom.by });
      bottom.states.push(state);
    }
    return fresh;
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

  /** The first part, however deep, the page does not show: parts agree with the whole, or there is no handle. */
  private async missing(fragment: AnyFragment): Promise<string | undefined> {
    for (const [name, child] of Object.entries((fragment.spec as Spec).uses ?? {})) {
      if (!(await this.shows(child))) return name;
      const deeper = await this.missing(child);
      if (deeper !== undefined) return `${name}.${deeper}`;
    }
    return undefined;
  }

  /** A fragment that stays keeps every part: one gone is the page changed, and every handle on it departs. */
  private async whole(fragment: AnyFragment, action: string, how: string): Promise<void> {
    const missing = await this.missing(fragment);
    if (missing === undefined) return;
    this.depart(action, fragment.name);
    throw new Error(`${fragment.name}.${action} ${how}, and its part ${missing} is missing`);
  }

  private async shows(fragment: AnyFragment): Promise<boolean> {
    const found = locate(this.page, fragment.spec.probe);
    return (await found.count()) > 0 && (await found.first().isVisible());
  }

  private handle<F extends AnyFragment>(
    fragment: F,
    within: Page | Locator,
    shared?: { state: State; owners: AnyFragment[] },
  ): Handle<F> {
    // A part already on the page is that part, whoever reached it first: one handle, one lifecycle.
    // Entered alone, it takes its owner's lifecycle; held by another owner, it answers to both.
    const prior = this.roots.get(fragment);
    const was = (prior as any)?.[META] as Meta | undefined;
    if (shared && prior !== undefined && was !== undefined && this.alive(was.state)) {
      if (was.owners.length === 1 && was.owners[0] === fragment) this.rebind(prior, shared);
      else this.own(prior, shared.owners);
      return prior as Handle<F>;
    }
    const region = locate(within, fragment.spec.probe).first();
    const state: State = shared?.state ?? { status: 'live', doc: this.doc };
    const meta: Meta = { fragment, owners: [...(shared?.owners ?? [fragment])], region, state };
    const self: Record<string | symbol, unknown> = { [META]: meta };
    this.states.set(self, state);
    // The latest handle is the one alive: any earlier one for this fragment departed or is covered with its owner.
    this.roots.set(fragment, self);

    // Owner and state are read from the meta each time: a handle entered alone is rebound when its owner arrives.
    const guard = (action: string, acting: boolean) => {
      if (!this.alive(meta.state)) {
        throw new Revoked(`${fragment.name} departed at ${meta.state.why}; ${action} has nothing to act on`);
      }
      if (acting && meta.state.status === 'covered') {
        throw new Revoked(`${fragment.name} is covered by ${meta.state.why}; ${action} would act under it`);
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
      // It answers to every fragment it is reached through: its owner, and that owner's owners.
      self[name] = this.handle(child, this.page, { state, owners: [...new Set([...meta.owners, fragment])] });
    }

    const actions = Object.entries((fragment.spec as Spec).actions ?? {});
    const run = async (name: string, args: unknown[]): Promise<unknown> => {
      guard(name, true);
      const declared = actions.find(([key]) => key === name)![1];
      if (typeof declared === 'function' || declared.kind === 'stays') {
        await this.stayed(fragment, meta.owners, meta.state, region, name, declared, args);
        return self;
      }
      return this.lead(fragment, self, meta.state, name, declared, args);
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

  /** A fragment entered alone takes its new owner's lifecycle; its parts keep every owner they had, and gain that one. */
  private rebind(handle: object, shared: { state: State; owners: AnyFragment[] }): void {
    const meta = (handle as any)[META] as Meta;
    meta.owners = [...shared.owners];
    for (const name of Object.keys((meta.fragment.spec as Spec).uses ?? {})) this.own((handle as any)[name], shared.owners);
    // An open cover keeps its own lifecycle: its owner joins it, in enter.
    if (this.covered.has(meta.state)) return;
    const inside = new Set([...shared.owners, ...[handle, ...this.within(handle)].map((each) => ((each as any)[META] as Meta).fragment)]);
    this.adopt(handle, shared.state, inside);
  }

  /** A handle's parts, at any depth. */
  private within(handle: object): object[] {
    const parts = Object.keys((((handle as any)[META] as Meta).fragment.spec as Spec).uses ?? {}).map((name) => (handle as any)[name]);
    return parts.flatMap((part) => [part, ...this.within(part)]);
  }

  /** A part another owner also holds keeps the lifecycle it has: the adopting owner leaving says nothing of that one. */
  private adopt(handle: object, state: State, inside: ReadonlySet<AnyFragment>): void {
    const meta = (handle as any)[META] as Meta;
    if (!meta.owners.every((each) => inside.has(each))) return;
    meta.state = state;
    this.states.set(handle, state);
    for (const name of Object.keys((meta.fragment.spec as Spec).uses ?? {})) this.adopt((handle as any)[name], state, inside);
  }

  /** A part reached by a second owner answers to both: which arrived first decides nothing. */
  private own(handle: object, owners: readonly AnyFragment[]): void {
    const meta = (handle as any)[META] as Meta;
    meta.owners = [...new Set([...meta.owners, ...owners])];
    for (const name of Object.keys((meta.fragment.spec as Spec).uses ?? {})) this.own((handle as any)[name], owners);
  }

  private async stayed(
    fragment: AnyFragment,
    owners: readonly AnyFragment[],
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
    for (const each of new Set([fragment, ...owners])) {
      if (!(await this.shows(each))) {
        this.depart(name, fragment.name);
        const who = each === fragment ? '' : ` ${each.name}`;
        throw new Error(`${fragment.name}.${name} is declared to stay, and${who} left: the page shows ${list(await this.sense())}`);
      }
    }
    await this.whole(fragment, name, 'is declared to stay');
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
    // A cover is witnessed opening: one that already shows cannot arrive by this action.
    const showed = new Set<string>();
    for (const to of Object.values(declared.outcomes)) {
      if (typeof to === 'object' && 'cover' in to && (await this.shows(to.cover))) showed.add(to.cover.name);
    }
    await declared.act(driver(region), ...rest);
    await settle(this.page, this.signals);

    // Arrival is witnessed from both ends, by one outcome. The destination shows;
    // what was left is gone, or still shows beneath a cover; and no second
    // declared outcome shows beside it, so the order of `leads` decides nothing.
    const shown = await this.sense();
    const under = this.covered.get(state);
    // A part answers to every owner using it: all of them showing is the page staying, any gone is it left.
    const { owners } = (self as any)[META] as Meta;
    const kept = owners.every((each) => shown.includes(each.name));
    const by = owners.map((each) => each.name).join(' and ');
    const target = (to: Outcomes[string]): AnyFragment | undefined =>
      to === back ? under?.fragment : typeof to === 'object' && 'cover' in to ? to.cover : (to as AnyFragment);
    const keys = Object.keys(declared.outcomes);
    const reached = keys.filter((key) => {
      const to = declared.outcomes[key];
      const where = to === stay ? undefined : target(to);
      // What a cover covers shows beneath it all along: going back is witnessed by the cover gone, and its owners.
      return where !== undefined && shown.includes(where.name) && !(to === back && (kept || shown.includes(under!.by)));
    });
    // An owner or the fragment itself seen gone is gone before any check below refuses the arrival; going back retires the cover alone.
    const left = !kept || !shown.includes(fragment.name);
    if (left && !(reached.length === 1 && declared.outcomes[reached[0]] === back)) this.depart(name, fragment.name);
    if (reached.length > 1) {
      throw new Error(`${fragment.name}.${name} reached ${reached.join(' and ')} at once; the page shows ${list(shown)}`);
    }
    const staying = keys.find((key) => declared.outcomes[key] === stay);
    // A part stays only with its owners, as on a plain stay.
    const outcome = reached[0] ?? (staying !== undefined && shown.includes(fragment.name) && kept ? staying : undefined);
    if (outcome === undefined) {
      if (under !== undefined && keys.some((key) => declared.outcomes[key] === back)) {
        throw new Error(`${fragment.name}.${name} went back to ${under.fragment.name}, and ${shown.includes(under.by) ? under.by : by} still shows`);
      }
      throw new Error(`${fragment.name}.${name} declares ${list(keys)}, and the page shows ${list(shown)}`);
    }
    const declaredTo = declared.outcomes[outcome];
    const to = declaredTo === stay ? stay : target(declaredTo)!;
    const covering = (key: string) => typeof declared.outcomes[key] === 'object' && 'cover' in declared.outcomes[key];
    if (to !== stay) {
      const missing = await this.missing(to as AnyFragment);
      if (missing !== undefined) throw new Error(`${fragment.name}.${name} reached ${(to as AnyFragment).name}, and its part ${missing} is missing`);
      const held = this.roots.get(to as AnyFragment);
      if (covering(outcome) && held !== undefined && this.alive(this.states.get(held)!)) {
        throw new Error(`${fragment.name}.${name} reached ${(to as AnyFragment).name} over ${by}, and ${(to as AnyFragment).name} was entered before it opened`);
      }
      if (covering(outcome) && showed.has((to as AnyFragment).name)) throw new Error(`${fragment.name}.${name} reached ${(to as AnyFragment).name} over ${by}, and ${(to as AnyFragment).name} showed before it`);
      if (covering(outcome) && !kept) {
        throw new Error(`${fragment.name}.${name} reached ${to.name} over ${by}, and ${by} is gone`);
      }
      if (declaredTo !== back && !covering(outcome) && !owners.includes(to) && kept) {
        throw new Error(`${fragment.name}.${name} reached ${to.name}, and ${by} still shows; declare it over(${to.name})`);
      }
    }
    if (to === stay) await this.whole(fragment, name, 'stayed');
    const toName = to === stay ? fragment.name : (to as AnyFragment).name;
    this.journal.push({ from: fragment.name, action: name, kind: 'lead', outcome, named, to: toName });

    let handle: object;
    if (to === stay) {
      state.doc = this.doc;
      handle = self;
    } else if (under !== undefined && under.fragment === to) {
      // Leaving a cover for what it covered returns the covered handle, live again. What left with the
      // cover owns nothing that stays: a part the page also holds answers to the page alone.
      const gone = new Set([...this.states].filter(([, each]) => each === state).map(([each]) => ((each as any)[META] as Meta).fragment));
      for (const each of this.states.keys()) {
        const meta = (each as any)[META] as Meta;
        meta.owners = meta.owners.filter((one) => !gone.has(one));
      }
      Object.assign(state, { status: 'departed', why: `${fragment.name}.${name}` });
      for (const each of under.states) Object.assign(each, { status: 'live', why: undefined, doc: this.doc });
      handle = under.handle;
    } else {
      const next = to as AnyFragment;
      // A modal covers the whole page, not the fragment that opened it: every live handle waits beneath.
      const beneath = covering(outcome) ? [...new Set(this.states.values())].filter((each) => this.alive(each) && each.status === 'live') : [];
      for (const each of beneath) Object.assign(each, { status: 'covered', why: next.name, doc: this.doc });
      if (!covering(outcome)) this.depart(name, fragment.name);
      handle = this.handle(next, this.page);
      // What waits beneath is the part's one root owner, not the part that opened the cover; with several, the part itself.
      const roots = owners.filter((each) => ((this.roots.get(each) as any)?.[META] as Meta | undefined)?.owners[0] === each);
      const waiting = roots.length === 1 ? roots[0] : fragment;
      if (covering(outcome)) {
        this.covered.set((handle as any)[META].state, { by: next.name, fragment: waiting, handle: this.roots.get(waiting) ?? self, states: beneath });
      }
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
  /** The fragments whose arrival made this handle: itself, or every one using it as a part. */
  owners: AnyFragment[];
  readonly region: Locator;
  state: State;
}

const list = (names: readonly string[]) => (names.length === 0 ? 'nothing' : names.join(', '));
