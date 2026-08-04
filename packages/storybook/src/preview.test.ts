// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
  collectStories,
  collectStory,
  previewUrl,
  showStory,
  type ShowRequest,
  type ShowResult,
  type StoryOutcome,
  type StoryPage,
} from './preview.js';

/**
 * Driving a preview, against a Storybook that is not one.
 *
 * There is no real Storybook in this repository, so what stands in for it is a
 * hand-written preview: a channel with the documented event names, a
 * `#storybook-root`, a `currentSelection`, and a per-story script of what the
 * preview does when asked. That is a fake, and it is worth being exact about
 * what a fake can and cannot prove.
 *
 * It **can** prove the things this file actually decides: that N stories cost
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
 */

const BASE = 'http://localhost:6006';

/** Fast enough to keep the suite quick, slow enough to take two poll samples. */
const TIMING = { timeoutMs: 80, pollMs: 5 } as const;

/** The marker a project's own code attaches when it considers itself settled. */
const READY = '[data-testid="story-ready"]';

describe('building a preview URL', () => {
  it('addresses a story on the preview iframe, in story view mode', () => {
    // `viewMode=docs` would render a page of prose around the component, and it
    // would be captured as the subject.
    expect(previewUrl(BASE, 'components-button--primary')).toBe(
      'http://localhost:6006/iframe.html?id=components-button--primary&viewMode=story',
    );
  });

  it('treats a base path as a directory rather than a file to replace', () => {
    // Without this, a Storybook served under a path resolves to the host root
    // and every story 404s identically.
    expect(previewUrl('http://example.test/design/storybook', 'a--b')).toBe(
      'http://example.test/design/storybook/iframe.html?id=a--b&viewMode=story',
    );
    expect(previewUrl('http://example.test/design/storybook/', 'a--b')).toBe(
      'http://example.test/design/storybook/iframe.html?id=a--b&viewMode=story',
    );
  });

  it('accepts a base that already names the preview itself', () => {
    // The likelier typo than a directory genuinely called `iframe.html`.
    expect(previewUrl('http://localhost:6006/iframe.html', 'a--b')).toBe(
      'http://localhost:6006/iframe.html?id=a--b&viewMode=story',
    );
  });

  it('works against a built Storybook on disk, with no server at all', () => {
    expect(previewUrl('file:///tmp/storybook-static', 'a--b')).toBe(
      'file:///tmp/storybook-static/iframe.html?id=a--b&viewMode=story',
    );
  });

  it('encodes a story id rather than pasting it into a query string', () => {
    // Story ids are derived from titles, and a title can contain anything.
    expect(previewUrl(BASE, 'a&b--c d')).toContain('id=a%26b--c+d');
  });

  it('refuses a link copied out of the manager instead of dropping half of it', () => {
    // `?path=/story/...` is the manager's URL, not the preview's. Joining onto
    // it would discard the query and quietly build a URL for a different story.
    expect(() => previewUrl(`${BASE}/?path=/story/components-button--primary`, 'a--b')).toThrow(
      /query or fragment/,
    );
  });

  it('refuses a host and port with no scheme, which URL parsing accepts as a protocol', () => {
    // `new URL('localhost:6006')` succeeds — protocol `localhost:`, path `6006`
    // — so the omitted scheme otherwise survives to a resolution failure whose
    // message is about `iframe.html` and says nothing about the real mistake.
    expect(() => previewUrl('localhost:6006', 'a--b')).toThrow(/protocol `localhost:`/);
  });

  it('refuses a base that is not a URL at all, and says what one looks like', () => {
    expect(() => previewUrl('./storybook-static', 'a--b')).toThrow(/absolute/);
  });

  it('refuses to build a URL for no story', () => {
    expect(() => previewUrl(BASE, '')).toThrow(/story id is required/);
  });
});

/** What the fake preview does when a story is selected. */
type Behaviour =
  | 'renders'
  | 'declares'
  | 'silent'
  | 'empty'
  | 'never-settles'
  | 'throws-on-select'
  | 'exception'
  | 'missing'
  | 'overlay';

interface FakePreview {
  /** Everything the page function emitted on the channel, in order. */
  readonly emitted: readonly { readonly event: string; readonly payload: unknown }[];
  /** Handlers still attached. A session that leaks these answers for the wrong story. */
  listeners(): number;
  select(storyId: string): void;
  dispose(): void;
}

function fakePreview(script: Readonly<Record<string, Behaviour>>, withChannel = true): FakePreview {
  const handlers = new Map<string, Set<(payload: unknown) => void>>();
  const emitted: { event: string; payload: unknown }[] = [];
  const selection: { storyId?: string } = {};
  const pending: ReturnType<typeof setTimeout>[] = [];
  const repeating: ReturnType<typeof setInterval>[] = [];

  const root = document.createElement('div');
  root.id = 'storybook-root';
  document.body.replaceChildren(root);

  const fire = (event: string, payload: unknown): void => {
    for (const handler of handlers.get(event) ?? []) handler(payload);
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
        break;
      case 'declares':
        // A component that keeps working after Storybook is done with it: the
        // event fires at 1ms and the application only settles at 12ms. Anything
        // that treats `storyRendered` as the finish line captures the gap.
        root.replaceChildren(paragraph(storyId));
        pending.push(setTimeout(() => fire('storyRendered', storyId), 1));
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
    select,
    dispose: () => {
      for (const timer of pending) clearTimeout(timer);
      for (const timer of repeating) clearInterval(timer);
      Reflect.deleteProperty(window, '__STORYBOOK_PREVIEW__');
      document.body.classList.remove('sb-show-errordisplay');
      document.body.replaceChildren();
    },
  };
}

interface FakePage extends StoryPage {
  readonly navigations: readonly string[];
}

/**
 * A page whose navigation boots the preview at the story the URL names, which is
 * how the first story of a real session arrives already rendered.
 */
function fakePage(preview: FakePreview | null): FakePage {
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
    evaluate: async (fn, request) => ship(fn)(request),
  };
}

/** Rebuild a page function from its own source, exactly as Playwright ships it. */
function ship(
  fn: (request: ShowRequest) => Promise<ShowResult>,
): (request: ShowRequest) => Promise<ShowResult> {
  const rebuilt: unknown = new Function(`return (${fn.toString()});`)();
  return rebuilt as (request: ShowRequest) => Promise<ShowResult>;
}

let preview: FakePreview | null = null;

afterEach(() => {
  preview?.dispose();
  preview = null;
});

describe('showing stories on one page', () => {
  it('navigates once, however many stories follow', async () => {
    // Acceptance 3, and the reason this module exists: a reload per story is the
    // per-subject setup cost ADR-0009 refuses to pay.
    preview = fakePreview({});
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two', 'a--three'], {
      baseUrl: BASE,
      ...TIMING,
    });

    expect(page.navigations).toHaveLength(1);
    expect(outcomes.map((outcome) => outcome.navigated)).toEqual([true, false, false]);
    expect(outcomes.every((outcome) => outcome.status === 'rendered')).toBe(true);
  });

  it('switches stories over the channel rather than by URL', async () => {
    preview = fakePreview({});
    const page = fakePage(preview);

    await collectStories(page, ['a--one', 'a--two'], { baseUrl: BASE, ...TIMING });

    expect(preview.emitted).toEqual([
      { event: 'setCurrentStory', payload: { storyId: 'a--two', viewMode: 'story' } },
    ]);
  });

  it('does not re-select the story the URL already chose', async () => {
    // Re-emitting would re-render a story that is sitting finished on the
    // screen, which is a second render nobody asked for and a chance to observe
    // the wrong one of the two.
    preview = fakePreview({ 'a--one': 'silent' });
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });

    expect(preview.emitted).toEqual([]);
    expect(outcome.status).toBe('rendered');
    expect(outcome.readiness).toBe('already-rendered');
  });

  it('reports Storybook’s own signal when it is the one that fired', async () => {
    // The distinction the whole result type exists for: this readiness knows
    // about decorators and loaders, and the fallback does not.
    preview = fakePreview({});
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two'], { baseUrl: BASE, ...TIMING });

    expect(outcomes[1]?.readiness).toBe('storyRendered');
    expect(outcomes[1]?.warnings).toEqual([]);
  });

  it('names the element the story mounted into', async () => {
    // The subject root, and the reason Storybook's chrome never reaches the
    // subject: the preview reset and the addon layout are outside this subtree,
    // so applicability pruning drops them for the ordinary reason (ADR-0003).
    preview = fakePreview({});
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });
    expect(outcome.root).toBe('#storybook-root');
  });

  it('removes its listeners between stories', async () => {
    // The page is never reloaded, so a handler left attached would answer for
    // the next story as well — and the first story's outcome would be decided
    // by the second story's event.
    preview = fakePreview({});
    const page = fakePage(preview);

    await collectStories(page, ['a--one', 'a--two', 'a--three'], { baseUrl: BASE, ...TIMING });

    expect(preview.listeners()).toBe(0);
  });
});

describe('a story that fails is a subject, not a crashed run', () => {
  it('reports a throwing render and observes the stories after it', async () => {
    // Acceptance 4. The failure this guards against is a suite that stops at the
    // fourth of three hundred subjects and reports nothing about the rest.
    preview = fakePreview({ 'a--two': 'exception' });
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two', 'a--three'], {
      baseUrl: BASE,
      ...TIMING,
    });

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rendered', 'errored', 'rendered']);
    expect(outcomes[1]?.error).toEqual({
      from: 'story',
      message: 'a--two threw',
      stack: 'at Story',
    });
  });

  it('catches a render that throws back out of the channel emit', async () => {
    // Storybook dispatches synchronously. Unhandled, this rejects the evaluate
    // and takes the whole run with it.
    preview = fakePreview({ 'a--two': 'throws-on-select' });
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two'], { baseUrl: BASE, ...TIMING });

    expect(outcomes[1]?.status).toBe('errored');
    expect(outcomes[1]?.error?.from).toBe('story');
    expect(outcomes[1]?.error?.message).toContain('exploded while rendering');
  });

  it('reports a story the preview does not have as missing, not as unchanged', async () => {
    // The index and the built preview disagreeing is a real and quiet failure:
    // one of them is stale, and a subject that silently observes nothing would
    // report the same as one that observed no change.
    preview = fakePreview({ 'a--two': 'missing' });
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two'], { baseUrl: BASE, ...TIMING });

    expect(outcomes[1]?.status).toBe('missing');
    expect(outcomes[1]?.error?.message).toContain('stale');
  });

  it('reads the preview’s error overlay when there is no event to carry the error', async () => {
    // A story that throws during the very first load errors before anything is
    // listening; all that is left is what the preview drew on the screen.
    preview = fakePreview({ 'a--one': 'overlay' });
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });

    expect(outcome.status).toBe('errored');
    expect(outcome.error?.message).toContain('could not be rendered');
  });

  it('refuses to call a story rendered when nothing mounted', async () => {
    // An unobservable subject reported as observed is a false `unchanged`
    // waiting to happen, so an empty root is its own status.
    preview = fakePreview({ 'a--one': 'empty' });
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });

    expect(outcome.status).toBe('no-root');
    expect(outcome.root).toBeUndefined();
  });

  it('reports a story that never settles as a timeout, not as a render', async () => {
    preview = fakePreview({ 'a--one': 'never-settles' });
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });

    expect(outcome.status).toBe('timeout');
    expect(outcome.error?.message).toContain('still changing');
  });

  it('blames the page, not the component, when the browser cannot be driven', async () => {
    // An agent handed `errored` for a closed page goes looking for a visual
    // regression in code that is fine.
    const page: FakePage = {
      navigations: [],
      url: () => 'about:blank',
      goto: async () => {
        throw new Error('Target page, context or browser has been closed');
      },
      evaluate: async () => {
        throw new Error('unreachable');
      },
    };

    const outcome = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });

    expect(outcome.status).toBe('unreachable');
    expect(outcome.error?.from).toBe('page');
    expect(outcome.error?.message).toContain('could not be driven');
  });

  it('blames the observer when the story rendered and the capture threw', async () => {
    // One unserializable capture must not cost the other 299 observations, and
    // must not be filed as a defect in the story that rendered fine.
    preview = fakePreview({});
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two'], {
      baseUrl: BASE,
      ...TIMING,
      observe: (outcome: StoryOutcome): void => {
        if (outcome.storyId === 'a--one') throw new Error('collector bundle missing');
      },
    });

    expect(outcomes[0]?.status).toBe('errored');
    expect(outcomes[0]?.error?.from).toBe('observer');
    expect(outcomes[1]?.status).toBe('rendered');
  });

  it('observes only the stories that rendered', async () => {
    // Capturing after a failed render would read the *previous* story's markup
    // under this story's id: a baseline that never corresponded to anything.
    preview = fakePreview({ 'a--two': 'exception' });
    const page = fakePage(preview);
    const observed: string[] = [];

    await collectStories(page, ['a--one', 'a--two', 'a--three'], {
      baseUrl: BASE,
      ...TIMING,
      observe: (outcome: StoryOutcome): void => {
        observed.push(outcome.storyId);
      },
    });

    expect(observed).toEqual(['a--one', 'a--three']);
  });
});

describe('a preview with no channel', () => {
  it('falls back to markup quiescence and says that is what it did', async () => {
    // The fallback is weaker evidence, not equivalent evidence. A caller that
    // cannot tell the two apart cannot know that a capture may be of a story
    // still waiting on a fetch.
    preview = fakePreview({ 'a--one': 'silent' }, false);
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', { baseUrl: BASE, ...TIMING });

    expect(outcome.status).toBe('rendered');
    expect(outcome.readiness).toBe('markup-quiescent');
    expect(outcome.channel).toBe(false);
    expect(outcome.warnings.join(' ')).toContain('no Storybook channel');
  });

  it('pays a reload per story, and reports that it paid one', async () => {
    // Without a channel there is no way to switch stories in place. The cost is
    // real and the run's economics are not what its owner thinks unless it says so.
    preview = fakePreview({ 'a--one': 'silent', 'a--two': 'silent' }, false);
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two'], { baseUrl: BASE, ...TIMING });

    expect(page.navigations).toHaveLength(2);
    expect(outcomes[1]?.navigated).toBe(true);
    expect(outcomes[1]?.warnings.join(' ')).toContain('ADR-0009');
  });
});

/**
 * The rung above Storybook's own signal.
 *
 * `storyRendered` is the framework's claim that the story function returned; the
 * marker is the subject's claim that it has finished. The fake keeps the two
 * twelve milliseconds apart on purpose, because that gap is the whole reason a
 * project would configure a marker at all.
 */
describe('a subject that declares its own readiness', () => {
  it('reports readiness `declared` when the subject attaches the marker', async () => {
    // Guards against the marker being accepted but filed under the framework's
    // signal: a caller that cannot see `declared` cannot tell the strongest
    // evidence from the second strongest, and the rung stops being worth having.
    preview = fakePreview({ 'a--one': 'declares', 'a--two': 'declares' });
    const page = fakePage(preview);
    const attachedWhenObserved: boolean[] = [];

    const outcomes = await collectStories(page, ['a--one', 'a--two'], {
      baseUrl: BASE,
      ...TIMING,
      readySelector: READY,
      // Guards against finishing at `storyRendered` and waiting for the marker
      // never: at 1ms the marker is not there yet, so an early finish is visible
      // here as a capture taken before the subject had settled.
      observe: (): void => {
        attachedWhenObserved.push(document.querySelector(READY) !== null);
      },
    });

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rendered', 'rendered']);
    expect(outcomes.map((outcome) => outcome.readiness)).toEqual(['declared', 'declared']);
    expect(attachedWhenObserved).toEqual([true, true]);
  });

  it('times out rather than falling back when a configured marker never appears', async () => {
    // The property this whole feature stands on. Both weaker paths are covered:
    // `a--one` is the story the URL already selected, whose markup goes quiet
    // immediately, and `a--two` is switched over the channel and does emit
    // `storyRendered`. Either one answered with `rendered` would mean a project
    // that asked to be asked was quietly answered with a guess — and it would
    // believe it held the strong signal while holding the weak one.
    preview = fakePreview({ 'a--one': 'silent', 'a--two': 'renders' });
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two'], {
      baseUrl: BASE,
      ...TIMING,
      readySelector: READY,
    });

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['timeout', 'timeout']);
    expect(outcomes.map((outcome) => outcome.readiness)).toEqual(['none', 'none']);
    for (const outcome of outcomes) {
      expect(outcome.readiness).not.toBe('markup-quiescent');
      expect(outcome.readiness).not.toBe('storyRendered');
      expect(outcome.readiness).not.toBe('already-rendered');
    }
  });

  it('names the marker that never appeared, so the contract is fixable', async () => {
    // A bare `timeout` sends someone to read the component; naming the selector
    // sends them to the one line of application code that was supposed to
    // attach it.
    preview = fakePreview({ 'a--one': 'silent' });
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', {
      baseUrl: BASE,
      ...TIMING,
      readySelector: READY,
    });

    expect(outcome.status).toBe('timeout');
    expect(outcome.error?.from).toBe('story');
    expect(outcome.error?.message).toContain(READY);
  });

  it('changes nothing at all when no marker is configured', async () => {
    // The absent option must be genuinely absent, not a default in disguise: a
    // marker nobody agreed to attach would turn every existing run into a suite
    // of timeouts.
    preview = fakePreview({ 'a--one': 'silent', 'a--two': 'renders' });
    const page = fakePage(preview);

    const outcomes = await collectStories(page, ['a--one', 'a--two'], { baseUrl: BASE, ...TIMING });

    expect(outcomes.map((outcome) => outcome.status)).toEqual(['rendered', 'rendered']);
    expect(outcomes.map((outcome) => outcome.readiness)).toEqual([
      'already-rendered',
      'storyRendered',
    ]);
    expect(outcomes.flatMap((outcome) => outcome.warnings)).toEqual([]);
    expect(page.navigations).toHaveLength(1);
  });

  it('accepts the marker alone when there is no channel to hear Storybook on', async () => {
    // Without a channel there is no framework signal to wait for, and the
    // fallback would otherwise be markup quiescence — which is exactly what the
    // marker exists to replace.
    preview = fakePreview({ 'a--one': 'declares' }, false);
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', {
      baseUrl: BASE,
      ...TIMING,
      readySelector: READY,
    });

    expect(outcome.status).toBe('rendered');
    expect(outcome.readiness).toBe('declared');
    expect(outcome.channel).toBe(false);
  });

  it('says in the warnings that the subject declared readiness, not the framework', async () => {
    // `declared` and `storyRendered` are one word apart in a result and a world
    // apart in what they claim. Anyone reading the outcome should not have to
    // know the union's ordering to see which happened.
    preview = fakePreview({ 'a--one': 'declares' });
    const page = fakePage(preview);

    const outcome = await collectStory(page, 'a--one', {
      baseUrl: BASE,
      ...TIMING,
      readySelector: READY,
    });

    expect(outcome.warnings.join(' ')).toContain(READY);
    expect(outcome.warnings.join(' ')).toContain('the application saying it has settled');
  });
});

describe('the page function', () => {
  it('survives being rebuilt from its own source, as Playwright rebuilds it', async () => {
    // The constraint that cannot be seen in a type check: a page function may
    // close over nothing. Every constant it needs arrives in the request.
    preview = fakePreview({ 'a--one': 'silent' });
    preview.select('a--one');

    const result = await ship(showStory)({
      storyId: 'a--one',
      timeoutMs: 80,
      pollMs: 5,
      events: {
        setCurrentStory: 'setCurrentStory',
        storyRendered: 'storyRendered',
        storyThrewException: 'storyThrewException',
        storyErrored: 'storyErrored',
        storyMissing: 'storyMissing',
        playFunctionThrewException: 'playFunctionThrewException',
      },
      roots: ['#storybook-root', '#root'],
      errorOverlay: { bodyClass: 'sb-show-errordisplay', message: '#error-message', stack: '#error-stack' },
    });

    expect(result.status).toBe('rendered');
    expect(result.channel).toBe(true);
  });
});
