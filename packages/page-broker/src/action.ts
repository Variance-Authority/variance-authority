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
  /** How long the app has to reach a declared outcome, in ms. Default 5000. */
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
/** How often the declared parts are looked for. A look is one round trip per part. */
const LOOK_EVERY = 25;

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
  act: (page: Page, ...args: Args) => Promise<void>,
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
  act: () => Promise<void>,
): Promise<Reached<Name>> {
  const parts = declared.parts.map((part) => ({ name: part.name, at: part.recognise(page) }));
  const visible = async (): Promise<typeof parts> => {
    const seen = await Promise.all(parts.map((part) => part.at.isVisible()));
    return parts.filter((_, index) => seen[index]);
  };

  // An outcome already on the page cannot be arrived at: the first look would
  // report it whatever the act did.
  const before = await visible();
  if (before[0] !== undefined) {
    throw new Error(
      `${declared.name}: ${before[0].name} is on the page before the action, so reaching it could not be told from standing still`,
    );
  }

  const traffic = watch(page);
  try {
    const started = Date.now();
    await act();
    traffic.touch();
    for (;;) {
      const seen = await visible();
      if (seen.length > 1) {
        throw new Error(
          `${declared.name}: reached ${seen.map((part) => part.name).join(' and ')} at once, so its outcomes are not told apart`,
        );
      }
      if (seen[0] !== undefined) return { outcome: seen[0].name, at: seen[0].at };
      const late = Date.now() - started >= declared.timeout;
      if (declared.staying !== undefined && (late || traffic.quietFor() >= declared.quiet)) {
        return { outcome: declared.staying, at: undefined };
      }
      if (late) {
        throw new Error(
          `${declared.name}: reached none of ${parts.map((part) => part.name).join(', ')} within ${declared.timeout} ms`,
        );
      }
      // No signal owns this wait: the app announces nothing, which is the
      // package's premise, so the page is looked at again.
      await new Promise((look) => setTimeout(look, LOOK_EVERY));
    }
  } finally {
    traffic.stop();
  }
}

interface Traffic {
  /** Marks now as the last thing that happened. */
  touch(): void;
  /** How long nothing has happened, in ms: 0 while a request is in flight. */
  quietFor(): number;
  stop(): void;
}

/**
 * Follows the page's requests, the one sign of pending work every app gives
 * without being asked. A stream the server never ends is not waited for.
 */
function watch(page: Page): Traffic {
  const flying = new Set<Request>();
  let last = Date.now();
  const began = (request: Request): void => {
    if (request.resourceType() === 'eventsource') return;
    flying.add(request);
    last = Date.now();
  };
  const ended = (request: Request): void => {
    if (flying.delete(request)) last = Date.now();
  };
  page.on('request', began);
  page.on('requestfinished', ended);
  page.on('requestfailed', ended);
  return {
    touch: () => {
      last = Date.now();
    },
    quietFor: () => (flying.size > 0 ? 0 : Date.now() - last),
    stop: () => {
      page.off('request', began);
      page.off('requestfinished', ended);
      page.off('requestfailed', ended);
    },
  };
}
