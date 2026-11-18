// compass: variance-authority.harness
import type { Locator, Page } from '@playwright/test';
import { elsewhere, type Elsewhere } from './elsewhere.js';
import { requests, type Quiet } from './quiet.js';

/**
 * The outcome of an action after which the app is where it was: none of the
 * declared parts appeared, and the page did not navigate, open another page or
 * open a modal dialog. It does not say the page is unchanged within itself.
 */
export const stay: unique symbol = Symbol('stay');

/** How one outcome is recognised: the part of the page that is visible once the app is there. */
export type Recogniser = (page: Page) => Locator;

/** An action's outcomes by name: a part of the page to arrive at, or {@link stay}. */
export type Outcomes = Readonly<Record<string, Recogniser | typeof stay>>;

/** Where an action ended. `at` is the part of the page recognised, and absent for {@link stay}. */
export interface Reached<Name extends string> {
  readonly outcome: Name;
  readonly at: Locator | undefined;
}

/** A started action: await it for the outcome reached, or insist on one with `to`. */
export interface Reaching<Name extends string> extends Promise<Reached<Name>> {
  /** Fails with `expected <name>, reached <other>` unless the action ended at `name`. */
  to<Insisted extends Name>(name: Insisted): Promise<Reached<Insisted>>;
}

/** An action declared once and performed on a page any number of times. */
export type Action<Name extends string, Args extends readonly unknown[]> = (
  page: Page,
  ...args: Args
) => Reaching<Name>;

/** How long the app has, and how its quiet is told. Not part of what a test declares. */
export interface Means {
  /** How long the app has, after the act, to reach an outcome or go quiet, in ms. */
  readonly timeout: number;
  readonly quiet: (page: Page) => Quiet;
}

/** How an action is declared: its name, its outcomes, and what the test does to the page. */
export type Declare = <const Declared extends Outcomes, Args extends readonly unknown[] = []>(
  name: string,
  outcomes: Declared,
  act: (page: Page, ...args: Args) => Promise<unknown>,
) => Action<keyof Declared & string, Args>;

/** {@link action} with other means than its own: a shorter time, another sign of quiet. */
export function by(means: Means): Declare {
  return (name, outcomes, act) => {
    type Name = keyof typeof outcomes & string;
    const names = Object.keys(outcomes) as Name[];
    if (names.length === 0) throw new Error(`${name}: declares no outcome`);
    const staying = names.filter((each) => outcomes[each] === stay);
    if (staying.length > 1) {
      throw new Error(`${name}: ${staying.join(' and ')} both stay, and nothing tells them apart`);
    }
    const declaration: Declaration<Name> = {
      name,
      parts: names.flatMap((each) => {
        const recognise: Recogniser | typeof stay | undefined = outcomes[each];
        return recognise === undefined || recognise === stay ? [] : [{ name: each, recognise }];
      }),
      staying: staying[0],
    };

    return (page, ...args) => {
      const reached = perform(declaration, means, page, () => act(page, ...args));
      const to = async <Insisted extends Name>(insisted: Insisted): Promise<Reached<Insisted>> => {
        const { outcome, at } = await reached;
        if (outcome !== insisted) {
          throw new Error(`${name}: expected ${insisted}, reached ${outcome}`);
        }
        return { outcome: insisted, at };
      };
      return Object.assign(reached, { to });
    };
  };
}

/**
 * Declares an action by the outcomes it can end in. Performing it runs `act`
 * and returns the name of the declared part of the page that became visible,
 * or of {@link stay} when the page went quiet where it was with none of them
 * on it. An app that went anywhere not declared fails the action.
 *
 * The app has 5000 ms after the act, and is quiet after 500 ms with no request
 * in flight.
 *
 * @example
 * const like = action('like', { liked: stay }, (page) => page.getByRole('button').click());
 * const submit = action('submit', { payment: (page) => page.getByRole('form') }, click);
 * const { outcome } = await submit(page); // 'payment'
 * await submit(page).to('payment'); // or: submit: expected payment, reached …
 */
export const action: Declare = by({ timeout: 5000, quiet: requests(500) });

interface Declaration<Name extends string> {
  readonly name: string;
  readonly parts: readonly { readonly name: Name; readonly recognise: Recogniser }[];
  readonly staying: Name | undefined;
}

async function perform<Name extends string>(
  declared: Declaration<Name>,
  means: Means,
  page: Page,
  act: () => Promise<unknown>,
): Promise<Reached<Name>> {
  const parts = declared.parts.map((part) => ({ name: part.name, at: part.recognise(page) }));
  const visible = async (): Promise<typeof parts> => {
    const seen = await Promise.all(parts.map((part) => part.at.isVisible()));
    return parts.filter((_, index) => seen[index]);
  };
  const named = (seen: typeof parts): Reached<Name> | undefined => {
    if (seen.length > 1) {
      throw new Error(
        `${declared.name}: reached ${seen.map((part) => part.name).join(' and ')} at once, so its outcomes are not told apart`,
      );
    }
    return seen[0] === undefined ? undefined : { outcome: seen[0].name, at: seen[0].at };
  };

  // An outcome already on the page cannot be arrived at: the first look would
  // report it whatever the act did.
  const before = await visible();
  if (before[0] !== undefined) {
    throw new Error(
      `${declared.name}: ${before[0].name} is on the page before the action, so reaching it could not be told from standing still`,
    );
  }

  const none = (then: string): string =>
    parts.length === 0 ? '' : `reached none of ${parts.map((part) => part.name).join(', ')}${then}`;
  const any = parts.map((part) => part.at).reduce<Locator | undefined>(
    (joined, at) => (joined === undefined ? at : joined.or(at)),
    undefined,
  );
  const quiet = means.quiet(page);
  let gone: Elsewhere | undefined;
  let out: ReturnType<typeof setTimeout> | undefined;
  try {
    gone = await elsewhere(page);
    await act();
    // The app's time starts when the act is done: a slow act does not spend it.
    const deadline = Date.now() + means.timeout;
    const late = new Promise<'late'>((resolve) => {
      out = setTimeout(() => resolve('late'), means.timeout);
    });
    for (;;) {
      const waits: Promise<'arrived' | 'late' | 'quiet'>[] = [late];
      if (any !== undefined) {
        // Arriving is Playwright's wait; only staying, which it has no word for, is ours.
        const arrived = arrival(any, deadline - Date.now());
        // A wait that loses the race ends on its own deadline, and has nobody left to tell.
        arrived.catch(() => undefined);
        waits.push(arrived);
      }
      // Asked for again on every pass: a quiet that ended before an arrival
      // woke the wait says nothing of what has begun since.
      if (declared.staying !== undefined) waits.push(quiet.settled());
      const woke = await Promise.race(waits);
      if (woke === 'late') break;
      const reached = named(await visible());
      if (reached !== undefined) return reached;
      if (woke !== 'quiet' || declared.staying === undefined) continue;
      const left = await gone.left();
      // What began while the page was looked at ended the quiet it was looked at in.
      if (!quiet.still()) continue;
      // Quiet somewhere else is not staying: no outcome says where the app is.
      if (left !== undefined) {
        throw new Error(`${declared.name}: ${none(', and ')}${left}, which no outcome declares`);
      }
      return { outcome: declared.staying, at: undefined };
    }
    // Time running out is never staying: with work still pending, the answer is not in.
    if (declared.staying === undefined) {
      throw new Error(`${declared.name}: ${none('')} within ${means.timeout} ms`);
    }
    const held = quiet.held();
    throw new Error(
      `${declared.name}: ${none(' and ')}the page did not go quiet within ${means.timeout} ms${held === undefined ? '' : `: ${held}`}`,
    );
  } finally {
    clearTimeout(out);
    quiet.stop();
    gone?.stop();
  }
}

/** Playwright's own wait for any declared part, or `late` when none came in the time left. */
async function arrival(any: Locator, left: number): Promise<'arrived' | 'late'> {
  try {
    // Only the visible ones are waited on: a recogniser may match its part while
    // it is hidden, and the first match would then be one that never shows.
    // To Playwright a timeout of 0 is no timeout at all.
    await any
      .filter({ visible: true })
      .first()
      .waitFor({ state: 'visible', timeout: Math.max(left, 1) });
    return 'arrived';
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') return 'late';
    throw error;
  }
}
