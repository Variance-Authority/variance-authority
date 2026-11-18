// compass: variance-authority.harness
import type { Locator, Page, Request } from '@playwright/test';

/** The outcome of an action that leaves the page as it was: nothing declared appeared. */
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

export interface ActionOptions {
  /** How long the app has, after the act, to reach an outcome or go quiet, in ms. Default 5000. */
  readonly timeout?: number;
  /**
   * How long the page must be quiet — the act finished, no request in flight —
   * before {@link stay} is reported, in ms. Default 500.
   */
  readonly quiet?: number;
}

/** An action declared once and performed on a page any number of times. */
export type Action<Name extends string, Args extends readonly unknown[]> = (
  page: Page,
  ...args: Args
) => Reaching<Name>;

const TIMEOUT = 5000;
const QUIET = 500;

/**
 * Declares an action by the outcomes it can end in. Performing it runs `act`
 * and returns the name of the declared part of the page that became visible,
 * or of {@link stay} when the page went quiet with none of them on it.
 *
 * @example
 * const like = action('like', { liked: stay }, (page) => page.getByRole('button').click());
 * const submit = action('submit', { payment: (page) => page.getByRole('form') }, click);
 * const { outcome } = await submit(page); // 'payment'
 * await submit(page).to('payment'); // or: submit: expected payment, reached …
 */
export function action<const Declared extends Outcomes, Args extends readonly unknown[] = []>(
  name: string,
  outcomes: Declared,
  act: (page: Page, ...args: Args) => Promise<unknown>,
  options: ActionOptions = {},
): Action<keyof Declared & string, Args> {
  type Name = keyof Declared & string;
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
    timeout: options.timeout ?? TIMEOUT,
    quiet: options.quiet ?? QUIET,
  };

  return (page, ...args) => {
    const reached = perform(declaration, page, () => act(page, ...args));
    const to = async <Insisted extends Name>(insisted: Insisted): Promise<Reached<Insisted>> => {
      const { outcome, at } = await reached;
      if (outcome !== insisted) {
        throw new Error(`${name}: expected ${insisted}, reached ${outcome}`);
      }
      return { outcome: insisted, at };
    };
    return Object.assign(reached, { to });
  };
}

interface Declaration<Name extends string> {
  readonly name: string;
  readonly parts: readonly { readonly name: Name; readonly recognise: Recogniser }[];
  readonly staying: Name | undefined;
  readonly timeout: number;
  readonly quiet: number;
}

async function perform<Name extends string>(
  declared: Declaration<Name>,
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

  const any = parts.map((part) => part.at).reduce<Locator | undefined>(
    (joined, at) => (joined === undefined ? at : joined.or(at)),
    undefined,
  );
  const traffic = watch(page, declared.quiet);
  try {
    await act();
    // The app's time starts when the act is done: a slow act does not spend it.
    const deadline = Date.now() + declared.timeout;
    const quiet = declared.staying === undefined ? NEVER : traffic.quiet();
    for (;;) {
      // Arriving is Playwright's wait; only staying, which it has no word for, is ours.
      const arrived = arrival(any, deadline - Date.now());
      const woke = await Promise.race([arrived, quiet]);
      // The wait that lost the race ends on its own deadline, and has nobody left to tell.
      arrived.catch(() => undefined);
      if (woke === 'late') break;
      const reached = named(await visible());
      if (reached !== undefined) return reached;
      if (woke === 'quiet' && declared.staying !== undefined) {
        return { outcome: declared.staying, at: undefined };
      }
    }
    // Time running out is never staying: with work still in flight, the answer is not in.
    const none = `reached none of ${parts.map((part) => part.name).join(', ')}`;
    if (declared.staying === undefined) {
      throw new Error(`${declared.name}: ${none} within ${declared.timeout} ms`);
    }
    const flying = traffic.flying();
    const held = flying.length === 0 ? '' : `: ${flying.join(', ')} still in flight`;
    throw new Error(
      `${declared.name}: ${none} and the page did not go quiet within ${declared.timeout} ms${held}`,
    );
  } finally {
    traffic.stop();
  }
}

const NEVER = new Promise<never>(() => undefined);

/** Playwright's own wait for any declared part, or `late` when none came in the time left. */
async function arrival(any: Locator | undefined, left: number): Promise<'arrived' | 'late'> {
  if (any === undefined) return new Promise((late) => setTimeout(() => late('late'), Math.max(left, 0)));
  if (left <= 0) return 'late';
  try {
    await any.first().waitFor({ state: 'visible', timeout: left });
    return 'arrived';
  } catch (error) {
    if (error instanceof Error && error.name === 'TimeoutError') return 'late';
    throw error;
  }
}

interface Traffic {
  /** Resolves once the act is done and no request has been in flight for the quiet period. */
  quiet(): Promise<'quiet'>;
  /** The requests still in flight, as `GET /path`. */
  flying(): string[];
  stop(): void;
}

/**
 * The kinds of request that are no sign of an answer on its way: a stream the
 * server never ends, and what a page loads to draw itself. The same kinds
 * `@variance-authority/playwright` does not wait for; held here because this
 * package imports nothing from it.
 */
const NOT_AWAITED: ReadonlySet<string> = new Set(['eventsource', 'font', 'image', 'media', 'websocket']);

/**
 * Follows the page's requests, the one sign of pending work every app gives
 * without being asked, from before the act so none it starts is missed.
 */
function watch(page: Page, period: number): Traffic {
  const flying = new Set<Request>();
  let acted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let settle: (value: 'quiet') => void = () => undefined;
  const settled = new Promise<'quiet'>((resolve) => {
    settle = resolve;
  });
  // A deadline, not a look: it is armed when the last request ends and
  // disarmed when another begins, so it fires only on a full quiet period.
  const arm = (): void => {
    clearTimeout(timer);
    if (acted && flying.size === 0) timer = setTimeout(() => settle('quiet'), period);
  };
  const began = (request: Request): void => {
    if (NOT_AWAITED.has(request.resourceType())) return;
    flying.add(request);
    clearTimeout(timer);
  };
  const ended = (request: Request): void => {
    if (flying.delete(request)) arm();
  };
  page.on('request', began);
  page.on('requestfinished', ended);
  page.on('requestfailed', ended);
  return {
    quiet: () => {
      acted = true;
      arm();
      return settled;
    },
    flying: () => [...flying].map((request) => `${request.method()} ${new URL(request.url()).pathname}`),
    stop: () => {
      clearTimeout(timer);
      page.off('request', began);
      page.off('requestfinished', ended);
      page.off('requestfailed', ended);
    },
  };
}
