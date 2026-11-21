// compass: variance-authority.harness
import {
  queryAllByLabelText,
  queryAllByRole,
  queryAllByTestId,
  queryAllByText,
  waitFor,
} from '@testing-library/dom';
import { userEvent } from '@testing-library/user-event';
import { away, pending } from './dom-watch.js';
import type { Query, Surface, Target } from './surface.js';

/** A document as page-broker sees it: what is found in it is an element, and `native` is the document. */
export type DocumentSurface = Surface<Document, Element>;

/** How long an act waits for the one element it acts on to be there and enabled, in ms. */
const ACTABLE = 5000;
/** How often a wait looks again for what no mutation announces, such as a style sheet, in ms. */
const POLL = 50;

/**
 * Page-broker over a document: jsdom's or happy-dom's in a unit test, or the
 * browser's own in a runner's browser mode. Parts are found the way Testing
 * Library finds them, the page is quiet once no request made with `fetch` or
 * `XMLHttpRequest` is in flight and the document has stopped changing, and
 * acts are a person's input as Testing Library's user-event makes it.
 *
 * @example
 * const reached = await submit(surface(document)); // { outcome: 'payment', at: <form> }
 */
export function surface(document: Document): DocumentSurface {
  const find = (query: Query): Target<Element> => ({ visible: async () => all(document, query).find(shown) });
  const one = (query: Query): Promise<Element> => actable(document, query);
  const user = userEvent.setup({ document });
  return {
    native: document,
    find,
    arrival: (targets, ms, done) => arrival(document, targets, ms, done),
    quiet: (period) => pending(document, period),
    elsewhere: async () => away(document),
    click: async (query) => user.click(await one(query)),
    fill: async (query, value) => {
      const element = await one(query);
      await user.clear(element);
      if (value !== '') await user.type(element, typed(value));
    },
    press: async (query, key) => {
      const element = await one(query);
      if (element instanceof document.defaultView!.HTMLElement) element.focus();
      await user.keyboard(keys(key));
    },
    check: async (query) => {
      const element = await one(query);
      if (!(element as HTMLInputElement).checked) await user.click(element);
    },
    select: async (query, value) => {
      const element = (await one(query)) as HTMLSelectElement;
      const option = [...element.options].find((each) => each.value === value || each.label === value);
      if (option === undefined) throw new Error(`${describe(query)} has no option ${value}`);
      await user.selectOptions(element, option);
    },
  };
}

/** Text as user-event types it, whose `{` and `[` open a key's name unless doubled. */
function typed(text: string): string {
  return text.replace(/[{[]/g, (bracket) => bracket + bracket);
}

/**
 * A key as Playwright names it — `Enter`, `a`, `Control+A` — as user-event
 * presses it: each modifier held down around the last key.
 */
function keys(key: string): string {
  if (key === '+') return key;
  const parts = key.length > 1 && key.endsWith('+') ? [...key.slice(0, -2).split('+'), '+'] : key.split('+');
  const last = parts.pop()!;
  const pressed = last.length === 1 ? typed(last) : `{${last}}`;
  return parts.map((held) => `{${held}>}`).join('') + pressed + parts.reverse().map((held) => `{/${held}}`).join('');
}

/** Every element the query matches, shown or not. */
function all(document: Document, query: Query): Element[] {
  const { body } = document;
  if (body === null) return [];
  if ('role' in query) {
    return queryAllByRole(body, query.role, query.name === undefined ? {} : { name: query.name });
  }
  if ('text' in query) return queryAllByText(body, query.text);
  if ('label' in query) return queryAllByLabelText(body, query.label);
  if ('testId' in query) return queryAllByTestId(body, query.testId);
  return [...body.querySelectorAll(query.css)];
}

/**
 * Whether a person could see the element, as far as a document without layout
 * can tell: neither it nor any element around it is hidden or not displayed.
 */
function shown(element: Element): boolean {
  const view = element.ownerDocument.defaultView;
  for (let at: Element | null = element; at !== null; at = at.parentElement) {
    if ((at as HTMLElement).hidden) return false;
    const style = view?.getComputedStyle(at);
    if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  }
  return element.isConnected;
}

/**
 * Waits by Testing Library's `waitFor`, which looks again on every mutation and
 * every `POLL` ms besides, for what no mutation announces, such as a style
 * sheet.
 */
async function arrival(
  document: Document,
  targets: readonly Target<Element>[],
  ms: number,
  done: AbortSignal,
): Promise<'arrived' | 'late'> {
  const any = async (): Promise<boolean> => (await Promise.all(targets.map((each) => each.visible()))).some(Boolean);
  if (await any()) return 'arrived';
  if (ms <= 0) return 'late';
  try {
    // `waitFor` takes no signal: an answered action ends it at its next look.
    await waitFor(
      async () => {
        if (!done.aborted && !(await any())) throw new Error('no outcome yet');
      },
      { container: document.documentElement, timeout: ms, interval: POLL },
    );
    return done.aborted ? 'late' : 'arrived';
  } catch {
    return 'late';
  }
}

/** The one shown, enabled element an act is for, once it is there. */
async function actable(document: Document, query: Query): Promise<Element> {
  let many = 0;
  const one = await waitFor(
    () => {
      const found = all(document, query).filter(shown);
      const ready = found.filter((each) => !(each as HTMLButtonElement).disabled);
      if (ready.length === 1) return ready[0]!;
      // More than one is no wait: it is an error now, and stays one.
      if (found.length > 1) {
        many = found.length;
        return undefined;
      }
      throw new Error(`${describe(query)} is ${found.length === 0 ? 'not on the page' : 'disabled'} after ${ACTABLE} ms`);
    },
    { container: document.documentElement, timeout: ACTABLE, interval: POLL, onTimeout: (error) => error },
  );
  if (one === undefined) throw new Error(`${describe(query)} matches ${many} elements, and an act is for one`);
  return one;
}

function describe(query: Query): string {
  return JSON.stringify(query, (_, value: unknown) => (value instanceof RegExp ? String(value) : value));
}
