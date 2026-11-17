// A broker between a test and the page: fragments are the only states a test
// may stand in, every action departs, settles and arrives, and a handle is
// revoked the moment the fragment it names is left.
//
// A prototype. It runs on Playwright only; the driver and read driver are the
// seam another runner would fill.
import type { Locator, Page } from '@playwright/test';
import { Documents } from './documents.js';
import { settle, type Signals } from './settle.js';
import type { Step } from './journal.js';
import type { Handle } from './handle.js';
import { driver, locate, readDriver } from './driver.js';
import { back, registry, stay, type Act, type AnyFragment, type Leads, type Outcomes, type Read, type Spec, type Stays } from './contract.js';

export { byLabel, byRole, byTestId, type Driver, type ReadDriver, type Where } from './driver.js';
export * from './contract.js';
export type { Handle } from './handle.js';

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
  private readonly documents: Documents;

  constructor(
    readonly page: Page,
    private readonly signals: Signals = {},
  ) {
    this.documents = new Documents(page);
  }

  private async settled(): Promise<void> {
    await settle(this.page, this.signals);
    await this.documents.counted;
  }

  /** Whether a state outlived every navigation since the broker last saw it; one that did not departs. */
  private alive(state: State): boolean {
    if (state.status !== 'departed' && state.doc !== this.documents.count) Object.assign(state, { status: 'departed', why: 'a navigation the broker did not take' });
    return state.status !== 'departed';
  }

  /** Settles, then requires the fragment to be what the page shows. */
  async enter<F extends AnyFragment>(fragment: F): Promise<Handle<F>> {
    await this.settled();
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

  /** What stays keeps every part, its owners' included: one gone is the page changed, and every handle on it departs. */
  private async whole(fragment: AnyFragment, owners: readonly AnyFragment[], action: string, how: string): Promise<void> {
    for (const each of new Set([fragment, ...owners])) {
      const missing = await this.missing(each);
      if (missing === undefined) continue;
      this.depart(action, fragment.name);
      throw new Error(`${fragment.name}.${action} ${how}, and ${each === fragment ? 'its' : `${each.name}'s`} part ${missing} is missing`);
    }
  }

  /** The page beneath a cover goes under and comes back whole: every fragment on it showing, with every part, or the page departs. */
  private async intact(states: readonly State[], action: string, from: string, says: string): Promise<void> {
    const fragments = new Set([...this.states].filter(([, each]) => states.includes(each)).map(([each]) => ((each as any)[META] as Meta).fragment));
    for (const look of [async (each: AnyFragment) => ((part) => part && `${each.name}'s part ${part} is missing`)(await this.missing(each)), async (each: AnyFragment) => ((await this.shows(each)) ? undefined : `${each.name} is gone`)]) {
      for (const each of fragments) {
        const why = await look(each);
        if (why === undefined) continue;
        this.depart(action, from);
        throw new Error(`${says}, and ${why}`);
      }
    }
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
      // A part covered on the page waits beneath it: a cover that uses it shares it, and does not take it along.
      if (was.owners.length === 1 && was.owners[0] === fragment && was.state.status === 'live') this.rebind(prior, shared);
      else this.own(prior, shared.owners);
      return prior as Handle<F>;
    }
    const region = locate(within, fragment.spec.probe).first();
    const state: State = shared?.state ?? { status: 'live', doc: this.documents.count };
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
        await this.documents.counted;
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
      await this.documents.counted;
      const declared = actions.find(([key]) => key === name)![1];
      const stays = typeof declared === 'function' || declared.kind === 'stays';
      const steps = this.journal.length;
      try {
        guard(name, true);
        if (!stays) return await this.lead(fragment, self, meta.state, name, declared as Leads, args);
        await this.stayed(fragment, meta.owners, meta.state, region, name, declared as Act | Stays, args);
        return self;
      } catch (error) {
        // A step that fails or is refused was still taken: the journal says where the walk stopped, and why.
        if (this.journal.length === steps) {
          this.journal.push({ from: fragment.name, action: name, kind: stays ? 'stay' : 'lead', to: fragment.name, failed: (error as Error).message });
        }
        // What failed may still have left or lost a part: the page is read again, and the test's error stands whatever it says.
        const shown = !(error instanceof Revoked) && this.alive(meta.state) ? await this.sense().catch((): string[] => []) : undefined;
        const broke = async (each: AnyFragment) => !shown!.includes(each.name) || (await this.missing(each).catch(() => 'unread')) !== undefined;
        if (shown !== undefined && (await Promise.all([fragment, ...meta.owners].map(broke))).some(Boolean)) this.depart(name, fragment.name);
        throw error;
      }
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
    await this.settled();
    if (until !== undefined) {
      const deadline = Date.now() + 10_000;
      while (!until.done(before, await until.read(readDriver(region)))) {
        if (Date.now() > deadline) throw new Error(`${fragment.name}.${name} never landed`);
        await this.settled();
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
    await this.whole(fragment, owners, name, 'is declared to stay');
    this.stamp(state, name, fragment.name);
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
    await this.settled();

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
    const covering = (key: string) => typeof declared.outcomes[key] === 'object' && 'cover' in declared.outcomes[key];
    let reached = keys.filter((key) => {
      const to = declared.outcomes[key];
      const where = to === stay ? undefined : target(to);
      // What a cover covers shows beneath it all along: going back is witnessed by the cover gone, and its owners.
      if (where === undefined || !shown.includes(where.name) || (to === back && (kept || shown.includes(under!.by)))) return false;
      // The fragment or an owner arrives again only on a new document: one that never left did not arrive.
      return !((where === fragment || owners.includes(where)) && state.doc === this.documents.count);
    });
    const staying = keys.find((key) => declared.outcomes[key] === stay);
    // A part stays only with its owners, as on a plain stay.
    const stays = staying !== undefined && shown.includes(fragment.name) && kept;
    // An outcome is there only whole: a probe alone with a part missing is not that fragment, and loses to any other answer.
    const complete: string[] = [];
    for (const key of reached) if ((await this.missing(target(declared.outcomes[key])!)) === undefined) complete.push(key);
    if (complete.length > 0 || reached.length > 1 || stays) reached = complete;
    // An owner or the fragment itself seen gone is gone before any check below refuses the arrival; going back retires the cover alone.
    // A new document is the old one left, whatever on it looks the same: only staying keeps the acting handle.
    const moved = state.doc !== this.documents.count;
    const left = !kept || !shown.includes(fragment.name) || (moved && reached.length > 0);
    // What arrives by a plain lead, entered already and live on this document, never left: it keeps its one handle.
    const plain = reached.length === 1 && !covering(reached[0]) && declared.outcomes[reached[0]] !== back;
    const prior = plain && !moved ? this.roots.get(target(declared.outcomes[reached[0]])!) : undefined;
    const spare = prior === undefined ? undefined : this.states.get(prior);
    const arrived = spare?.status === 'live' && spare.doc === this.documents.count ? prior : undefined;
    if (left && !(reached.length === 1 && declared.outcomes[reached[0]] === back)) this.depart(name, fragment.name, arrived && [arrived]);
    if (reached.length > 1) {
      throw new Error(`${fragment.name}.${name} reached ${reached.join(' and ')} at once; the page shows ${list(shown)}`);
    }
    const outcome = reached[0] ?? (stays ? staying : undefined);
    if (outcome === undefined) {
      if (under !== undefined && keys.some((key) => declared.outcomes[key] === back)) {
        throw new Error(`${fragment.name}.${name} went back to ${under.fragment.name}, and ${shown.includes(under.by) ? under.by : by} still shows`);
      }
      throw new Error(`${fragment.name}.${name} declares ${list(keys)}, and the page shows ${list(shown)}`);
    }
    const declaredTo = declared.outcomes[outcome];
    const to = declaredTo === stay ? stay : target(declaredTo)!;
    if (to !== stay) {
      const missing = await this.missing(to as AnyFragment);
      if (missing !== undefined) {
        // Not there is not arrived: the page departs only if what acted left it, or a cover closed over it.
        if (left || declaredTo === back) this.depart(name, fragment.name);
        throw new Error(`${fragment.name}.${name} found ${(to as AnyFragment).name} without its part ${missing}`);
      }
      // Going back restores the whole page beneath the cover, and all of it comes back whole or none of it does.
      if (declaredTo === back) await this.intact(under!.states.filter((each) => this.alive(each)), name, fragment.name, `${fragment.name}.${name} went back to ${(to as AnyFragment).name}`);
      const held = this.roots.get(to as AnyFragment);
      if (covering(outcome) && held !== undefined && this.alive(this.states.get(held)!)) {
        throw new Error(`${fragment.name}.${name} reached ${(to as AnyFragment).name} over ${by}, and ${(to as AnyFragment).name} was entered before it opened`);
      }
      if (covering(outcome) && showed.has((to as AnyFragment).name)) throw new Error(`${fragment.name}.${name} reached ${(to as AnyFragment).name} over ${by}, and ${(to as AnyFragment).name} showed before it`);
      if (covering(outcome) && (!kept || moved)) {
        throw new Error(`${fragment.name}.${name} reached ${to.name} over ${by}, and ${by} is gone`);
      }
      if (declaredTo !== back && !covering(outcome) && !owners.includes(to) && kept && !moved) {
        throw new Error(`${fragment.name}.${name} reached ${to.name}, and ${by} still shows; declare it over(${to.name})`);
      }
    }
    // What an arrival keeps, it keeps whole: a stay keeps the fragment, and a cover keeps what it opened over.
    if (to === stay || covering(outcome)) await this.whole(fragment, owners, name, to === stay ? 'stayed' : `opened ${(to as AnyFragment).name}`);
    // A modal covers the whole page, not the fragment that opened it: every live handle waits beneath, and waits whole.
    const beneath = covering(outcome) ? [...new Set(this.states.values())].filter((each) => this.alive(each) && each.status === 'live') : [];
    if (covering(outcome)) await this.intact(beneath, name, fragment.name, `${fragment.name}.${name} opened ${(to as AnyFragment).name}`);
    const toName = to === stay ? fragment.name : (to as AnyFragment).name;
    const wrong = named !== undefined && outcome !== named ? `${fragment.name}.${name} was expected to reach ${named}, and reached ${outcome} (${list(shown)})` : undefined;
    this.journal.push({ from: fragment.name, action: name, kind: 'lead', outcome, named, to: toName, failed: wrong });

    let handle: object;
    if (to === stay) {
      this.stamp(state, name, fragment.name);
      handle = self;
    } else if (under !== undefined && declaredTo === back) {
      // Going back, and only going back, returns the covered handle, live again. What left with the
      // cover owns nothing that stays: a part the page also holds answers to the page alone.
      const gone = new Set([...this.states].filter(([, each]) => each === state).map(([each]) => ((each as any)[META] as Meta).fragment));
      for (const each of this.states.keys()) {
        const meta = (each as any)[META] as Meta;
        meta.owners = meta.owners.filter((one) => !gone.has(one));
      }
      Object.assign(state, { status: 'departed', why: `${fragment.name}.${name}` });
      // Only what is still on this document comes back: a page that left while covered stays left, and arrives anew.
      const kept = under.states.filter((each) => this.alive(each));
      for (const each of kept) Object.assign(each, { status: 'live', why: undefined, doc: this.documents.count });
      handle = kept.includes((under.handle as any)[META].state) ? under.handle : this.handle(to as AnyFragment, this.page);
    } else {
      const next = to as AnyFragment;
      for (const each of beneath) Object.assign(each, { status: 'covered', why: next.name, doc: this.documents.count });
      if (!covering(outcome)) this.depart(name, fragment.name, arrived && [arrived]);
      handle = arrived ?? this.handle(next, this.page);
      // What waits beneath is the part's one root owner, not the part that opened the cover; with several, the part itself.
      const roots = owners.filter((each) => ((this.roots.get(each) as any)?.[META] as Meta | undefined)?.owners[0] === each);
      const waiting = roots.length === 1 ? roots[0] : fragment;
      if (covering(outcome)) {
        this.covered.set((handle as any)[META].state, { by: next.name, fragment: waiting, handle: this.roots.get(waiting) ?? self, states: beneath });
      }
    }
    // A wrong branch is still the branch taken: the handles and the journal say so before the test fails.
    if (wrong !== undefined) throw new Error(wrong);
    return named === undefined ? { outcome, handle } : handle;
  }

  /** The acting handle stays on the document it is seen on, its part tree whole; any other on an older one left with it, as the broker saw. */
  private stamp(state: State, action: string, from: string): void {
    if (state.doc !== this.documents.count) this.depart(action, from, [...this.states].filter(([, each]) => each === state).map(([each]) => each));
    state.doc = this.documents.count;
  }

  /** Leaving a page revokes everything on it, the dialogs over it included; what arrived live keeps its part tree, owned within it, on a state of its own. */
  private depart(action: string, from: string, arrived: readonly object[] = []): void {
    const tree = [...new Set(arrived.flatMap((each) => [each, ...this.within(each)]))];
    const inside = new Set(tree.map((each) => ((each as any)[META] as Meta).fragment));
    const own = tree.length === 0 ? undefined : ((tree[0] as any)[META] as Meta).state;
    const shared = [...this.states].some(([each, state]) => state === own && !tree.includes(each));
    const spared: State | undefined = shared ? { status: 'live', doc: this.documents.count } : own;
    for (const state of this.states.values()) {
      if (state.status !== 'departed' && state !== spared) Object.assign(state, { status: 'departed', why: `${from}.${action}` });
    }
    for (const each of tree) {
      const meta = (each as any)[META] as Meta;
      const owners = meta.owners.filter((one) => inside.has(one));
      meta.owners = owners.length > 0 ? owners : [meta.fragment];
      meta.state = spared!;
      this.states.set(each, spared!);
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
