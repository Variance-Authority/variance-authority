// compass: variance-authority.harness
import {
  fireEvent,
  queryAllByLabelText,
  queryAllByRole,
  queryAllByTestId,
  queryAllByText,
  waitFor,
} from '@testing-library/dom';
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
 * acts are dispatched as the events a person's input would fire.
 *
 * @example
 * const reached = await submit(surface(document)); // { outcome: 'payment', at: <form> }
 */
export function surface(document: Document): DocumentSurface {
  const find = (query: Query): Target<Element> => ({ visible: async () => all(document, query).find(shown) });
  const one = (query: Query): Promise<Element> => actable(document, query);
  return {
    native: document,
    find,
    arrival: (targets, ms) => arrival(document, targets, ms),
    quiet: (period) => pending(document, period),
    elsewhere: async () => away(document),
    click: async (query) => press(await one(query)),
    fill: async (query, value) => {
      const element = await one(query);
      if (element instanceof document.defaultView!.HTMLElement) element.focus();
      fireEvent.input(element, { target: { value } });
      fireEvent.change(element, { target: { value } });
    },
    press: async (query, key) => {
      const element = await one(query);
      fireEvent.keyDown(element, { key });
      fireEvent.keyUp(element, { key });
    },
    check: async (query) => {
      const element = await one(query);
      if (!(element as HTMLInputElement).checked) press(element);
    },
    select: async (query, value) => {
      const element = (await one(query)) as HTMLSelectElement;
      const option = [...element.options].find((each) => each.value === value || each.label === value);
      if (option === undefined) throw new Error(`${describe(query)} has no option ${value}`);
      fireEvent.change(element, { target: { value: option.value } });
    },
  };
}

/**
 * A click as a user's mouse makes it: down, up, then click. A widget may answer
 * the press rather than the click, and one that cancels the press keeps focus
 * where it was.
 */
function press(element: Element): void {
  fireEvent.pointerDown(element, { button: 0 });
  const focusing = fireEvent.mouseDown(element, { button: 0 });
  if (focusing && element instanceof element.ownerDocument.defaultView!.HTMLElement) element.focus();
  fireEvent.pointerUp(element, { button: 0 });
  fireEvent.mouseUp(element, { button: 0 });
  fireEvent.click(element, { button: 0 });
}

/** Every element the query matches, shown or not. A frame not yet there holds none. */
function all(document: Document, query: Query): Element[] {
  const root = query.frame === undefined ? document : document.querySelector<HTMLIFrameElement>(query.frame)?.contentDocument;
  if (root === null || root === undefined || root.body === null) return [];
  const body = root.body;
  if ('role' in query) {
    return queryAllByRole(body, query.role, query.name === undefined ? {} : { name: query.name });
  }
  if ('text' in query) return queryAllByText(body, query.text);
  if ('label' in query) return queryAllByLabelText(body, query.label);
  if ('testId' in query) return queryAllByTestId(body, query.testId);
  return [...root.querySelectorAll(query.css)];
}

/**
 * Whether a person could see the element, as far as a document without layout
 * can tell: neither it nor any element around it is hidden or not displayed.
 */
export function shown(element: Element): boolean {
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
 * every `POLL` ms besides, for what no mutation announces: a frame's document,
 * a style sheet.
 */
async function arrival(document: Document, targets: readonly Target<Element>[], ms: number): Promise<'arrived' | 'late'> {
  const any = async (): Promise<boolean> => (await Promise.all(targets.map((each) => each.visible()))).some(Boolean);
  if (await any()) return 'arrived';
  if (ms <= 0) return 'late';
  try {
    await waitFor(
      async () => {
        if (!(await any())) throw new Error('no outcome yet');
      },
      { container: document.documentElement, timeout: ms, interval: POLL },
    );
    return 'arrived';
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
  const { frame, ...rest } = query;
  return `${JSON.stringify(rest, (_, value: unknown) => (value instanceof RegExp ? String(value) : value))}${frame === undefined ? '' : ` in ${frame}`}`;
}
