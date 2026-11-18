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
    expect(notes.map(([, , text]) => text)).toEqual([
      'dom + dialog role="dialog" "Open"',
      'dom + h2 role="heading"',
      'dom @aria-busy p "idle" absent→"true"',
      'page +1 −0 nodes, 1 attribute, 0 text',
      'dom text p "idle"→"done"',
      'dom − p "done"',
      'page +0 −1 nodes, 0 attributes, 1 text',
    ]);
    expect(lines.map(([, , line, said]) => [line, said])).toEqual([[10, 0], [11, 4], [13, 7]]);
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

    expect(tap.read().notes.map(([, , text]) => text)).toEqual(['dom + dialog role="dialog"', 'dom + p', 'page +2 −0 nodes, 0 attributes, 0 text']);
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
    expect(notes.map(([, , text]) => text)).toEqual([
      'dom + dialog role="dialog"',
      'page +1 −0 nodes, 0 attributes, 0 text',
      'dom + p',
      'page +1 −0 nodes, 0 attributes, 0 text',
    ]);
    expect(lines.map(([, , line, said]) => [line, said])).toEqual([[4, 0], [9, 2]]);
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
    expect(notes.map(([, , text]) => text)).toEqual(['dom + dialog role="dialog"', 'page +1 −0 nodes, 0 attributes, 0 text']);
    expect(lines.map(([, , line, said]) => [line, said])).toEqual([[4, 0], [6, 2]]);
  });

  it('writes each change as one line naming the node, under the line that made it, and never what a field holds', () => {
    const tap = openTap();
    const { window } = new JSDOM('<main><ul><li id="c3">Item C3</li></ul><input type="password" value="old"></main>');
    const { document } = window;
    listen(tap, { console: { ...console }, document, MutationObserver: window.MutationObserver });

    tap.root.c(10);
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-label', 'Confirm order');
    const yes = document.createElement('button');
    yes.textContent = 'Yes';
    dialog.append(document.createElement('span'), yes);
    document.body.append(dialog);
    document.getElementById('c3')!.remove();
    const secret = document.querySelector('input')!;
    secret.setAttribute('value', 'hunter2');
    secret.value = 'typed';
    tap.root.c(11);
    tap.settle();

    // The dialog is one line for its root and one for the button inside it, which
    // a search finds by its role; the span, which has none, is not written.
    const said = tap.read().notes.map(([, , text]) => text);
    expect(said).toEqual([
      'dom + div role="dialog" "Confirm order"',
      'dom + button role="button" "Yes"',
      'dom − li id="c3" role="listitem" "Item C3"',
      'dom @value input type="password"',
      'page +1 −1 nodes, 1 attribute, 0 text',
    ]);
    expect(said.join('\n')).not.toMatch(/hunter2|typed|old/);
  });

  it('starts no page watch in a realm with no document', () => {
    const tap = openTap();
    listen(tap, { console: { ...console } });
    tap.root.c(1);
    tap.root.c(2);
    expect(tap.read().notes).toEqual([]);
  });
});
