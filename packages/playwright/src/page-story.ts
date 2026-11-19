import { navigationNote } from '@variance-authority/core/format';
import type { Page } from 'playwright';

/** Where a story recorded in this realm listens: `NOTE` in sense's `story-listen.cts`. */
const NOTE = Symbol.for('variance-authority.story.note');

type Realm = { [NOTE]?: unknown };

// Looked up on every line, so a story that stops recording hears no more of it.
// A channel that throws is swallowed here, not inside Playwright's emitter.
const say = (text: string): void => {
  const note = (globalThis as Realm)[NOTE];
  if (typeof note !== 'function') return;
  try {
    note(text);
  } catch {}
};

/**
 * Tells a story recorded in this realm what a page did that the test cannot
 * see from Node: what it printed, each document its top frame loaded, what it
 * threw and that it crashed, each on the step running when Node heard it.
 *
 * Attaches nothing where no story records as the page opens. Chromium's
 * `Page.frameNavigated` commits a new document, and the
 * `Page.frameStartedNavigating` with the same loader id says whether it was a
 * reload.
 */
export async function tellStory(page: Page): Promise<void> {
  if (typeof (globalThis as Realm)[NOTE] !== 'function') return;
  page.on('console', (message) => {
    const type = message.type();
    say(`page console.${type === 'warning' ? 'warn' : type} ${message.text()}`);
  });
  page.on('pageerror', (error) => say(`page error ${String(error).split('\n')[0]}`));
  page.on('crash', () => say('page crashed'));
  const session = await page.context().newCDPSession(page);
  await session.send('Page.enable');
  // A top frame keeps its id across the documents it loads.
  const top = (await session.send('Page.getFrameTree')).frameTree.frame.id;
  const reloads = new Map<string, boolean>();
  session.on('Page.frameStartedNavigating', (event) => {
    if (event.frameId !== top) return;
    reloads.set(event.loaderId, event.navigationType === 'reload' || event.navigationType === 'reloadBypassingCache');
  });
  session.on('Page.frameNavigated', ({ frame }) => {
    if (frame.id !== top) return;
    say(navigationNote(frame.url, reloads.get(frame.loaderId) === true));
    // A start that never committed was cancelled; its verdict answers nothing.
    reloads.clear();
  });
}
