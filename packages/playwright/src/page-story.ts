import type { Page } from 'playwright';

/** Where a story recorded in this realm listens: `NOTE` in sense's `story-listen.cts`. */
const NOTE = Symbol.for('variance-authority.story.note');

type Realm = { [NOTE]?: unknown };

// Looked up on every line, so a story that stops recording hears no more of it.
const say = (text: string): void => {
  const note = (globalThis as Realm)[NOTE];
  if (typeof note === 'function') note(text);
};

/**
 * Tells a story recorded in this realm what a page did that the test cannot
 * see from Node: what it printed, each document its top frame loaded, what it
 * threw and that it crashed. A note lands on the step it happened during.
 *
 * Attaches nothing where no story records as the page opens. The navigation is
 * the engine's: Chromium's `Page.frameNavigated` commits a new document and
 * not a change within one, and `Page.frameStartedNavigating` says whether it
 * was a reload, so a link back to the same address is not called one.
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
  let reload = false;
  session.on('Page.frameStartedNavigating', (event) => {
    if (event.frameId === top) reload = event.navigationType === 'reload' || event.navigationType === 'reloadBypassingCache';
  });
  session.on('Page.frameNavigated', ({ frame }) => {
    if (frame.id !== top) return;
    say(`page navigated ${frame.url.split(/[?#]/)[0]}${reload ? ' (reload)' : ''}`);
    reload = false;
  });
}
