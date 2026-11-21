// compass: variance-authority.harness
import type { Elsewhere, Query, Surface, Target } from './surface.js';

/**
 * The outcome of an action after which the app is where it was: none of the
 * declared regions appeared, and the page did not navigate, open another page
 * or open a modal dialog. It does not say the page is unchanged within itself.
 */
export const stay: unique symbol = Symbol('stay');

/** A part of the page a model names: where an action starts, or where it can end. */
export interface Region<Name extends string = string> {
  readonly name: Name;
  readonly query: Query;
}

/** Names a part of the page once, for every action that starts or ends there. */
export function region<const Name extends string>(name: Name, query: Query): Region<Name> {
  return { name, query };
}

/** The names of the regions visible now, in the order given. Nothing is acted on. */
export async function here(surface: Surface, regions: readonly Region[]): Promise<string[]> {
  const seen = await Promise.all(regions.map((each) => surface.find(each.query).visible()));
  return regions.filter((_, index) => seen[index] !== undefined).map((each) => each.name);
}

/** Actions read together, as data: the regions they name, and which of them can start where the page is. */
export interface Model {
  /** Each action, in the order given. */
  readonly actions: readonly Declared[];
  /** Every region the actions start from or lead to, once each, in the order first named. */
  readonly regions: readonly Region[];
  /** The actions that can start among the regions named: one of theirs is there, or they declare none. */
  from(regions: readonly string[]): Declared[];
}

/**
 * Reads actions as one model, performing none of them. With {@link here}, it
 * names the actions possible on the page now.
 *
 * @example
 * const shop = model([submit, pay]);
 * shop.from(await here(on, shop.regions)); // [submit.declared]
 */
export function model(actions: readonly { readonly declared: Declared }[]): Model {
  const declared = actions.map((each) => each.declared);
  const regions = new Map<string, Region>();
  for (const each of declared) {
    for (const part of [...each.from, ...Object.values(each.to)]) {
      if (part === stay) continue;
      const known = regions.get(part.name);
      if (known !== undefined && known !== part) throw new Error(`${part.name}: two regions by one name`);
      regions.set(part.name, part);
    }
  }
  return {
    actions: declared,
    regions: [...regions.values()],
    from: (names) => declared.filter((each) => each.from.length === 0 || each.from.some((part) => names.includes(part.name))),
  };
}

/** An action's outcomes by name: a region to arrive at, or {@link stay}. */
export type Outcomes = Readonly<Record<string, Region | typeof stay>>;

/** Where an action can start, and where it can end. */
export interface Ends<To extends Outcomes> {
  /** The regions the action starts from; it is refused unless one of them is visible. */
  readonly from?: Region | readonly Region[];
  readonly to: To;
}

/** Where an action ended. `at` is what the surface found, and absent for {@link stay}. */
export interface Reached<Name extends string, Handle = unknown> {
  readonly outcome: Name;
  readonly at: Handle | undefined;
}

/** A started action: await it for the outcome reached, or insist on one with `to`. */
export interface Reaching<Name extends string, Handle = unknown> extends Promise<Reached<Name, Handle>> {
  /** Fails with `expected <name>, reached <other>` unless the action ended at `name`. */
  to<Insisted extends Name>(name: Insisted): Promise<Reached<Insisted, Handle>>;
}

/** An action as data, read without performing it. */
export interface Declared<To extends Outcomes = Outcomes> {
  readonly name: string;
  readonly from: readonly Region[];
  /** Its outcomes by name, each the region it leads to or {@link stay}, in the order declared. */
  readonly to: To;
}

/** An action declared once and performed on a surface any number of times. */
export interface Action<Name extends string, Args extends readonly unknown[], S extends Surface = Surface> {
  <Handle>(surface: S & Surface<unknown, Handle>, ...args: Args): Reaching<Name, Handle>;
  readonly declared: Declared<Readonly<Record<Name, Region | typeof stay>>>;
}

/**
 * Why an action did not end where it should: it was not where it starts, or
 * started where its outcomes could not be told apart; it ended at another
 * outcome than the one insisted on, at two at once, somewhere undeclared, at
 * none in time, or with the page still busy when time ran out.
 */
export type Reason = 'start' | 'expected' | 'both' | 'elsewhere' | 'late' | 'unquiet';

/** An action that did not end at an outcome it declares, or not at the one insisted on. */
export class Unreached extends Error {
  override readonly name = 'Unreached';
  constructor(
    message: string,
    /** The action's name. */
    readonly action: string,
    /** The outcomes it declares. */
    readonly outcomes: readonly string[],
    readonly reason: Reason,
    /** Where the app went instead, or what kept it busy, in words, when that is known. */
    readonly went?: string,
  ) {
    super(message);
  }
}

/** How long the app has, and how long the page must be quiet. Not part of what a test declares. */
export interface Means {
  /** How long the app has, after the act, to reach an outcome or go quiet, in ms. */
  readonly timeout: number;
  /** How long nothing may be pending before the page is quiet, in ms. */
  readonly quiet: number;
}

/** How an action is declared: its name, where it starts and ends, and what the test does to the page. */
export type Declare = <const To extends Outcomes, Args extends readonly unknown[] = [], S extends Surface = Surface>(
  name: string,
  ends: Ends<To>,
  act: (surface: S, ...args: Args) => Promise<unknown>,
) => Action<keyof To & string, Args, S>;

/** {@link action} with other means than its own: a shorter time, a shorter quiet. */
export function by(means: Means): Declare {
  return <const To extends Outcomes, Args extends readonly unknown[], S extends Surface>(
    name: string,
    ends: Ends<To>,
    act: (surface: S, ...args: Args) => Promise<unknown>,
  ): Action<keyof To & string, Args, S> => {
    type Name = keyof To & string;
    const names = Object.keys(ends.to) as Name[];
    if (names.length === 0) throw new Error(`${name}: declares no outcome`);
    const staying = names.filter((each) => ends.to[each] === stay);
    if (staying.length > 1) {
      throw new Error(`${name}: ${staying.join(' and ')} both stay, and nothing tells them apart`);
    }
    const from: readonly Region[] = ends.from === undefined ? [] : 'query' in ends.from ? [ends.from] : ends.from;
    const declaration: Declaration<Name> = {
      name,
      from,
      names,
      parts: names.flatMap((each) => {
        const to = ends.to[each];
        return to === undefined || to === stay ? [] : [{ name: each, query: to.query }];
      }),
      staying: staying[0],
    };

    const performed = <Handle>(surface: S & Surface<unknown, Handle>, ...args: Args): Reaching<Name, Handle> => {
      const reached = perform<Name, Handle>(declaration, means, surface, () => act(surface, ...args));
      const to = async <Insisted extends Name>(insisted: Insisted): Promise<Reached<Insisted, Handle>> => {
        const { outcome, at } = await reached;
        if (outcome !== insisted) {
          throw new Unreached(`${name}: expected ${insisted}, reached ${outcome}`, name, names, 'expected', outcome);
        }
        return { outcome: insisted, at };
      };
      return Object.assign(reached, { to });
    };
    return Object.assign(performed, { declared: { name, from: [...from], to: { ...ends.to } } });
  };
}

/**
 * Declares an action by where it starts and the outcomes it can end in, and
 * returns it performable on any surface. Performing it names the outcome the
 * app reached, or fails with {@link Unreached}; how an outcome is decided is in
 * the package README.
 *
 * @example
 * const submit = action('submit', { to: { payment, invalid: stay } }, (on) => on.click({ role: 'button', name: 'Continue' }));
 * await submit(surface(page)).to('payment'); // or: submit: expected payment, reached invalid
 */
export const action: Declare = by({ timeout: 5000, quiet: 500 });

interface Declaration<Name extends string> {
  readonly name: string;
  readonly from: readonly Region[];
  readonly names: readonly Name[];
  readonly parts: readonly { readonly name: Name; readonly query: Query }[];
  readonly staying: Name | undefined;
}

async function perform<Name extends string, Handle>(
  declared: Declaration<Name>,
  means: Means,
  surface: Surface<unknown, Handle>,
  act: () => Promise<unknown>,
): Promise<Reached<Name, Handle>> {
  const fail = (message: string, reason: Reason, went?: string): Unreached =>
    new Unreached(`${declared.name}: ${message}`, declared.name, declared.names, reason, went);
  const parts = declared.parts.map((part) => ({ name: part.name, target: surface.find(part.query) }));
  const look = async (among: typeof parts): Promise<{ name: Name; at: Handle }[]> => {
    const seen = await Promise.all(among.map((part) => part.target.visible()));
    return among.flatMap((part, index) => {
      const at = seen[index];
      return at === undefined ? [] : [{ name: part.name, at }];
    });
  };

  if (declared.from.length > 0) {
    const started = await Promise.all(declared.from.map((each) => surface.find(each.query).visible()));
    if (started.every((at) => at === undefined)) {
      throw fail(`starts from ${declared.from.map((each) => each.name).join(' or ')}, and none is on the page`, 'start');
    }
  }

  // A region already on the page is never arrived at: the action rests there,
  // told the way staying is, once the page is quiet and it is still there,
  // at the address it started on or another.
  const before = await look(parts);
  if (before.length > 1) {
    throw fail(`${before.map((part) => part.name).join(' and ')} are on the page before the action, so they could not be told apart`, 'start');
  }
  const resting = before[0] === undefined ? undefined : parts.find((part) => part.name === before[0]!.name);
  if (resting !== undefined && declared.staying !== undefined) {
    throw fail(`${resting.name} is on the page before the action, and ${declared.staying} stays, so they could not be told apart`, 'start');
  }
  const arriving = parts.filter((part) => part !== resting);
  const rests = resting !== undefined || declared.staying !== undefined;

  const none = (then: string): string =>
    parts.length === 0 ? '' : `reached none of ${parts.map((part) => part.name).join(', ')}${then}`;
  const quiet = surface.quiet(means.quiet);
  let gone: Elsewhere | undefined;
  let out: ReturnType<typeof setTimeout> | undefined;
  const answered = new AbortController();
  try {
    gone = await surface.elsewhere();
    await act();
    // A deadline that names the outcomes never reached, never a wait. The app's
    // time starts when the act is done: a slow act does not spend it.
    const deadline = Date.now() + means.timeout;
    const late = new Promise<'late'>((resolve) => {
      out = setTimeout(() => resolve('late'), means.timeout);
    });
    const targets: readonly Target<Handle>[] = arriving.map((part) => part.target);
    // An action with nowhere to rest still hears the first quiet, to tell an
    // app gone somewhere undeclared; quiet anywhere else is no answer to it.
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
      if (rests || hearing) waits.push(quiet.settled());
      const woke = await Promise.race(waits);
      if (woke === 'late') break;
      if (woke === 'arrived') arrival = undefined;
      const arrived = await look(arriving);
      if (arrived.length > 1) {
        const both = arrived.map((part) => part.name).join(' and ');
        throw fail(`reached ${both} at once, so its outcomes are not told apart`, 'both', both);
      }
      if (arrived[0] !== undefined) return { outcome: arrived[0].name, at: arrived[0].at };
      if (woke !== 'quiet') continue;
      const still = resting === undefined ? undefined : (await look([resting]))[0];
      const left = await gone.left();
      // What began while the page was looked at ended the quiet it was looked at in.
      if (!quiet.still()) continue;
      // A new address that still shows the region is where the action rests;
      // anywhere else, quiet is not resting: no outcome says where the app is.
      if (left !== undefined && !(still !== undefined && left.by === 'address')) {
        throw fail(`${none(', and ')}${left.words}, which no outcome declares`, 'elsewhere', left.words);
      }
      hearing = false;
      if (still !== undefined) return { outcome: still.name, at: still.at };
      if (declared.staying !== undefined) return { outcome: declared.staying, at: undefined };
      // The region it rested in has gone and nothing has arrived: the answer is not in.
    }
    // Time running out is never staying: with work still pending, the answer is not in.
    const left = await gone.left();
    if (left !== undefined) throw fail(`${none(', and ')}${left.words}, which no outcome declares`, 'elsewhere', left.words);
    const held = quiet.held();
    if (!rests || (held === undefined && quiet.still())) throw fail(`${none('')} within ${means.timeout} ms`, 'late');
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
