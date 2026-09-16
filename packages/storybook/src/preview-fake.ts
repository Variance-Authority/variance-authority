import type { StoryPage } from './preview.js';

/**
 * Driving a preview, against a Storybook that is not one.
 *
 * There is no real Storybook in this repository, so what stands in for it is a
 * hand-written preview: a channel with the documented event names, a
 * `#storybook-root`, a `currentSelection`, and a per-story script of what the
 * preview does when asked. That is a fake, and it is worth being exact about
 * what a fake can and cannot prove.
 *
 * It **can** prove the things the driver actually decides: that N stories cost
 * one navigation, that the readiness signal reported is the one that was used,
 * that a throwing story is an outcome rather than an exception, that listeners
 * do not accumulate across a session, and that a story which never settles is
 * never called rendered.
 *
 * It **cannot** prove that Storybook emits these events with these payloads.
 * That is a claim about someone else's package, and the only thing that can
 * settle it is a real preview.
 *
 * One further precaution: `evaluate` rebuilds the page function from its own
 * source, exactly as Playwright ships it into a browser. A page function that
 * closed over a module constant type-checks, passes a naive fake, and fails with
 * a `ReferenceError` inside a headless browser where nobody sees it.
 *
 * It sits beside the suites rather than inside one because two of them drive it,
 * and a fake pasted into each would become two different Storybooks that agree
 * about nothing in particular.
 */

export const BASE = 'http://localhost:6006';

/** Fast enough to keep the suite quick, slow enough to take two poll samples. */
export const TIMING = { timeoutMs: 80, pollMs: 5 } as const;

/** The marker a project's own code attaches when it considers itself settled. */
export const READY = '[data-testid="story-ready"]';

/** What the fake preview does when a story is selected. */
export type Behaviour =
  | 'renders'
  | 'declares'
  | 'silent'
  | 'empty'
  | 'never-settles'
  | 'never-finishes'
  | 'finishes-badly'
  | 'throws-on-select'
  | 'exception'
  | 'missing'
  | 'overlay';

export interface FakePreview {
  /** Everything the page function emitted on the channel, in order. */
  readonly emitted: readonly { readonly event: string; readonly payload: unknown }[];
  /** Handlers still attached. A session that leaks these answers for the wrong story. */
  listeners(): number;
  /** Whether the preview ever fired this event — what the driver heard, not what it asked for. */
  heard(event: string): boolean;
  select(storyId: string): void;
  dispose(): void;
}

export function fakePreview(
  script: Readonly<Record<string, Behaviour>>,
  withChannel = true,
): FakePreview {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const emitted: { event: string; payload: unknown }[] = [];
  const selection: { storyId?: string } = {};
  const pending: ReturnType<typeof setTimeout>[] = [];
  const repeating: ReturnType<typeof setInterval>[] = [];

  const root = document.createElement('div');
  root.id = 'storybook-root';
  document.body.replaceChildren(root);

  const fired = new Set<string>();

  const fire = (event: string, payload: unknown): void => {
    fired.add(event);
    for (const handler of handlers.get(event) ?? []) handler(payload);
  };

  const finishes = (storyId: string, status: string, delayMs: number): void => {
    pending.push(setTimeout(() => fire('storyFinished', { storyId, status }), delayMs));
  };

  const paragraph = (text: string): HTMLElement => {
    const element = document.createElement('p');
    element.textContent = text;
    return element;
  };

  const select = (storyId: string): void => {
    selection.storyId = storyId;
    document.body.classList.remove('sb-show-errordisplay');

    switch (script[storyId] ?? 'renders') {
      case 'renders':
        root.replaceChildren(paragraph(storyId));
        pending.push(setTimeout(() => fire('storyRendered', storyId), 1));
        // Storybook 8.3 and later emit this a phase later, once `afterEach` and
        // reporting are done. The gap is the whole reason a driver must wait for
        // it — see `ShowEvents.storyFinished`.
        finishes(storyId, 'success', 3);
        break;
      case 'declares':
        // A component that keeps working after Storybook is done with it: the
        // event fires at 1ms and the application only settles at 12ms. Anything
        // that treats `storyRendered` as the finish line captures the gap.
        root.replaceChildren(paragraph(storyId));
        pending.push(setTimeout(() => fire('storyRendered', storyId), 1));
        finishes(storyId, 'success', 3);
        pending.push(
          setTimeout(() => {
            const marker = document.createElement('div');
            marker.setAttribute('data-testid', 'story-ready');
            root.appendChild(marker);
          }, 12),
        );
        break;
      case 'silent':
        // Rendered, but says nothing: the shape of the first story of a session,
        // whose `storyRendered` fired before anything was listening.
        root.replaceChildren(paragraph(storyId));
        break;
      case 'empty':
        root.replaceChildren();
        break;
      case 'finishes-badly':
        // Rendered, finished, and failed: a `play` that threw after the last
        // paint, or an `afterEach` that raised. Storybook's own way of saying so
        // is the status on the finish, and the picture is on screen either way.
        root.replaceChildren(paragraph(storyId));
        pending.push(setTimeout(() => fire('storyRendered', storyId), 1));
        finishes(storyId, 'error', 3);
        break;
      case 'never-finishes':
        // Rendered and then stuck in a later phase — the shape of a story whose
        // `afterEach` never returns. Storybook would eventually reload the
        // preview over this one; the driver must not wait forever for it.
        root.replaceChildren(paragraph(storyId));
        pending.push(setTimeout(() => fire('storyRendered', storyId), 1));
        break;
      case 'never-settles':
        root.replaceChildren(paragraph(storyId));
        repeating.push(setInterval(() => root.appendChild(paragraph(String(Math.random()))), 2));
        break;
      case 'throws-on-select':
        // Storybook's channel dispatches synchronously, so a render that throws
        // can throw straight back out of the caller's `emit`.
        throw new Error(`${storyId} exploded while rendering`);
      case 'exception':
        pending.push(
          setTimeout(() => fire('storyThrewException', { message: `${storyId} threw`, stack: 'at Story' }), 1),
        );
        break;
      case 'missing':
        pending.push(setTimeout(() => fire('storyMissing', storyId), 1));
        break;
      case 'overlay': {
        root.replaceChildren();
        const message = document.createElement('div');
        message.id = 'error-message';
        message.textContent = `${storyId} could not be rendered`;
        document.body.appendChild(message);
        document.body.classList.add('sb-show-errordisplay');
        break;
      }
    }
  };

  if (withChannel) {
    const channel = {
      on: (event: string, handler: (payload: unknown) => void): void => {
        const set = handlers.get(event) ?? new Set<(payload: unknown) => void>();
        set.add(handler);
        handlers.set(event, set);
      },
      off: (event: string, handler: (payload: unknown) => void): void => {
        handlers.get(event)?.delete(handler);
      },
      emit: (event: string, payload: unknown): void => {
        emitted.push({ event, payload });
        if (event !== 'setCurrentStory') {
          fire(event, payload);
          return;
        }
        select(String((payload as { storyId?: unknown }).storyId));
      },
    };

    Reflect.set(window, '__STORYBOOK_PREVIEW__', { channel, currentSelection: selection });
  }

  return {
    emitted,
    listeners: () => [...handlers.values()].reduce((total, set) => total + set.size, 0),
    heard: (event: string) => fired.has(event),
    select,
    dispose: () => {
      for (const timer of pending) clearTimeout(timer);
      for (const timer of repeating) clearInterval(timer);
      Reflect.deleteProperty(window, '__STORYBOOK_PREVIEW__');
      // What the page function learned about *this* preview, and no other. The
      // window outlives a fake, so leaving it set would let one test's Storybook
      // decide how the next test's driver waits.
      Reflect.deleteProperty(window, '__variance_authority_story_finished__');
      document.body.classList.remove('sb-show-errordisplay');
      document.body.replaceChildren();
    },
  };
}

export interface FakePage extends StoryPage {
  readonly navigations: readonly string[];
}

/**
 * A page whose navigation boots the preview at the story the URL names, which is
 * how the first story of a real session arrives already rendered.
 */
export function fakePage(preview: FakePreview | null): FakePage {
  const navigations: string[] = [];
  let current = 'about:blank';

  return {
    navigations,
    url: () => current,
    goto: async (url: string): Promise<void> => {
      navigations.push(url);
      current = url;
      const id = new URL(url).searchParams.get('id');
      if (preview !== null && id !== null) preview.select(id);
    },
    evaluate: async (fn, argument) => ship(fn)(argument),
  };
}

/** Rebuild a page function from its own source, exactly as Playwright ships it. */
export function ship<A, R>(fn: (argument: A) => R | Promise<R>): (argument: A) => R | Promise<R> {
  const rebuilt: unknown = new Function(`return (${fn.toString()});`)();
  return rebuilt as (argument: A) => R | Promise<R>;
}
