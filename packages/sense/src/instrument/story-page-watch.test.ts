import { createRequire } from 'node:module';
import { JSDOM } from 'jsdom';
import { describe, expect, it } from 'vitest';
import probeLog from './probe-log.cjs';
import probeSet from './probe-set.cjs';

// Built, as a seam loads them: the tap `require`s the engine by its built name.
const storyTap = createRequire(import.meta.url)(
  '../../dist/instrument/story-tap.cjs',
) as typeof import('./story-tap.cjs');
const { listen } = createRequire(import.meta.url)('../../dist/instrument/story-listen.cjs') as typeof import('./story-listen.cjs');

function openTap() {
  const engine = probeLog.createEngine(false, probeSet.probeSet);
  engine.use(engine.open('case'));
  return storyTap.createTap(engine, storyTap.TAPE_LIMIT);
}

describe('what a test line did to the page', () => {
  it('says what a test line changed on the page, on that line, and nothing for a line that changed none', () => {
    const tap = openTap();
    const { window } = new JSDOM('<main><p>idle</p></main>');
    const { document } = window;
    listen(tap, { console: { ...console }, document, MutationObserver: window.MutationObserver });
    listen(tap, { console: { ...console }, document, MutationObserver: window.MutationObserver });

    tap.root.c(10);
    const dialog = document.createElement('dialog');
    dialog.append(document.createElement('h2'), 'Open');
    document.body.append(dialog);
    document.querySelector('p')!.setAttribute('aria-busy', 'true');
    tap.root.c(11);
    document.querySelector('p')!.firstChild!.nodeValue = 'done';
    document.querySelector('p')!.remove();
    tap.root.c(12);
    tap.root.c(13);

    // Each line's changes are said before the next line opens, so they sit on
    // the line that made them; the dialog's own children came with it, and a
    // second listen watches the page once. Line 12 changed nothing, so it
    // gives way to line 13 as any line nothing followed does.
    const { lines, notes } = tap.read();
    expect(notes.map(([, , text]) => text)).toEqual(['page +1 −0 nodes, 1 attribute, 0 text', 'page +0 −1 nodes, 0 attributes, 1 text']);
    expect(lines.map(([, , line, said]) => [line, said])).toEqual([[10, 0], [11, 1], [13, 2]]);
  });

  it('says what a line that awaits changed once, counted since it opened', async () => {
    const tap = openTap();
    const { window } = new JSDOM('<main></main>');
    const { document } = window;
    listen(tap, { console: { ...console }, document, MutationObserver: window.MutationObserver });

    tap.root.c(4);
    document.body.append(document.createElement('dialog'));
    await Promise.resolve();
    document.body.append(document.createElement('p'));
    await Promise.resolve();
    tap.root.c(5);
    tap.settle();

    expect(tap.read().notes.map(([, , text]) => text)).toEqual(['page +2 −0 nodes, 0 attributes, 0 text']);
  });

  it('says what the last line changed when the case settles, and nothing its hooks or cleanup change', async () => {
    const tap = openTap();
    const { window } = new JSDOM('<main></main>');
    const { document } = window;
    listen(tap, { console: { ...console }, document, MutationObserver: window.MutationObserver });

    tap.root.c(4);
    document.body.append(document.createElement('dialog'));
    tap.settle();
    tap.root.c(6, undefined, true);
    document.body.append(document.createElement('hr'));
    document.body.replaceChildren();
    await Promise.resolve();
    tap.root.c(2, undefined, true);
    document.body.append(document.createElement('main'));
    tap.root.c(9);
    document.body.append(document.createElement('p'));
    tap.settle();

    const { lines, notes } = tap.read();
    expect(notes.map(([, , text]) => text)).toEqual(['page +1 −0 nodes, 0 attributes, 0 text', 'page +1 −0 nodes, 0 attributes, 0 text']);
    expect(lines.map(([, , line, said]) => [line, said])).toEqual([[4, 0], [9, 1]]);
  });

  // A page's runner settles no case before its hooks: it takes the tape after them.
  it('says what the last line changed when a hook opens, and nothing the hook or what follows it change', async () => {
    const tap = openTap();
    const { window } = new JSDOM('<main></main>');
    const { document } = window;
    listen(tap, { console: { ...console }, document, MutationObserver: window.MutationObserver });

    tap.root.c(4);
    document.body.append(document.createElement('dialog'));
    tap.root.c(6, undefined, true);
    document.body.append(document.createElement('hr'));
    await Promise.resolve();
    document.body.replaceChildren();
    tap.settle();

    const { lines, notes } = tap.read();
    expect(notes.map(([, , text]) => text)).toEqual(['page +1 −0 nodes, 0 attributes, 0 text']);
    expect(lines.map(([, , line, said]) => [line, said])).toEqual([[4, 0], [6, 1]]);
  });

  it("says what a realm's line readers answer when a test line ends, and nothing they answer for a hook's", () => {
    const tap = openTap();
    const { window } = new JSDOM('<main></main>');
    let asked = 0;
    const answers = ['before', 'third', '', 'fifth', 'hooked', 'eighth'];
    const lasts: unknown[] = [];
    const realm = { console: { ...console }, document: window.document, MutationObserver: window.MutationObserver, [Symbol.for('variance-authority.story.line')]: [(line: { last: boolean }) => (lasts.push(line.last), answers[asked++]), 'not a reader', () => { throw new Error('cannot tell'); }] };
    listen(tap, realm);

    tap.root.c(3);
    tap.root.c(4);
    tap.root.c(5);
    tap.root.c(6, undefined, true);
    tap.root.c(8);
    tap.settle();

    // Each reader is asked at every drain, before each line and when the case
    // settles; what it answers for a test line is that line's note, an empty
    // answer says nothing, and what it answers for a hook or before the first line is dropped.
    expect(tap.read().notes.map(([, , text]) => text)).toEqual(['third', 'fifth', 'eighth']);
    expect(asked).toBe(6);
    // `last` where no test line follows: a hook's line opens, or the case settles.
    expect(lasts).toEqual([false, false, false, true, false, true]);
  });

  it('starts no page watch in a realm with no document', () => {
    const tap = openTap();
    listen(tap, { console: { ...console } });
    tap.root.c(1);
    tap.root.c(2);
    expect(tap.read().notes).toEqual([]);
  });
});
