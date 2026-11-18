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
      'dom + dialog "Open"',
            'dom @aria-busy p "idle" absent→"true"',
      'page +1 −0 nodes, 1 attribute, 0 text',
      'dom text p "idle"→"done"',
      'dom − p "done"',
      'page +0 −1 nodes, 0 attributes, 1 text',
    ]);
    expect(lines.map(([, , line, said]) => [line, said])).toEqual([[10, 0], [11, 3], [13, 6]]);
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

    expect(tap.read().notes.map(([, , text]) => text)).toEqual(['dom + dialog', 'dom + p', 'page +2 −0 nodes, 0 attributes, 0 text']);
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
      'dom + dialog',
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
    expect(notes.map(([, , text]) => text)).toEqual(['dom + dialog', 'page +1 −0 nodes, 0 attributes, 0 text']);
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
    // holds a text of its own; the span, which holds nothing a search could name, is not written.
    const said = tap.read().notes.map(([, , text]) => text);
    expect(said).toEqual([
      'dom + div role="dialog" "Confirm order"',
      'dom + button "Yes"',
      'dom − li id="c3" "Item C3"',
      'dom @value input type="password"',
      'page +1 −1 nodes, 1 attribute, 0 text',
    ]);
    expect(said.join('\n')).not.toMatch(/hunter2|typed|old/);
  });

  it('writes a node moved as taken away and put back, and one put in and taken out as both', () => {
    const tap = openTap();
    const { window } = new JSDOM('<main><ul><li id="a">Item A</li><li id="b">Item B</li></ul></main>');
    const { document } = window;
    listen(tap, { console: { ...console }, document, MutationObserver: window.MutationObserver });

    tap.root.c(10);
    document.querySelector('ul')!.insertBefore(document.getElementById('b')!, document.getElementById('a'));
    const toast = document.createElement('div');
    toast.setAttribute('role', 'status');
    toast.textContent = 'Saved';
    document.body.append(toast);
    toast.remove();
    tap.root.c(11);
    tap.settle();

    expect(tap.read().notes.map(([, , text]) => text)).toEqual([
      'dom − li id="b" "Item B"',
      'dom + li id="b" "Item B"',
      'dom + div role="status" "Saved"',
      'dom − div role="status" "Saved"',
      'page +2 −2 nodes, 0 attributes, 0 text',
    ]);
  });

  it('never writes what a text box holds, as the text it replaced or inside what holds it', () => {
    const tap = openTap();
    const { window } = new JSDOM('<main><label>Note<textarea>draft</textarea></label></main>');
    const { document } = window;
    listen(tap, { console: { ...console }, document, MutationObserver: window.MutationObserver });

    tap.root.c(10);
    const box = document.querySelector('textarea')!;
    box.defaultValue = 'hunter2';
    box.defaultValue = 'hunter3';
    document.querySelector('label')!.remove();
    tap.root.c(11);
    tap.settle();

    const said = tap.read().notes.map(([, , text]) => text);
    // The box inside the label is not written: what would name it is what was typed into it.
    expect(said).toEqual(['dom − label "Note"', 'page +2 −3 nodes, 0 attributes, 0 text']);
    expect(said.join('\n')).not.toMatch(/draft|hunter/);
  });

  it('never writes what a person typed into an editable region, or which option a list has chosen', () => {
    const tap = openTap();
    const { window } = new JSDOM(
      '<main><section><div contenteditable>draft</div></section><select><option>Visa 1111</option><option>Visa 2222</option></select></main>',
    );
    const { document } = window;
    listen(tap, { console: { ...console }, document, MutationObserver: window.MutationObserver });

    tap.root.c(10);
    const editor = document.querySelector('[contenteditable]')!;
    editor.firstChild!.nodeValue = 'hunter2';
    const line = document.createElement('div');
    line.append(Object.assign(document.createElement('b'), { textContent: 'hunter3' }));
    editor.append(line);
    document.querySelectorAll('option')[1]!.setAttribute('selected', '');
    tap.root.c(11);
    document.querySelector('section')!.remove();
    tap.root.c(12);
    tap.settle();

    const said = tap.read().notes.map(([, , text]) => text);
    expect(said).toEqual([
      'dom + div',
      'dom @selected option absent→""',
      'page +1 −0 nodes, 1 attribute, 1 text',
      'dom − section',
      'page +0 −1 nodes, 0 attributes, 0 text',
    ]);
    expect(said.join('\n')).not.toMatch(/draft|hunter|Visa/);
  });

  it('writes nothing for a value set and set back before the page was read', () => {
    const tap = openTap();
    const { window } = new JSDOM('<main><p class="a">idle</p></main>');
    const { document } = window;
    listen(tap, { console: { ...console }, document, MutationObserver: window.MutationObserver });

    tap.root.c(10);
    const p = document.querySelector('p')!;
    p.className = 'b';
    p.className = 'a';
    p.firstChild!.nodeValue = 'busy';
    p.firstChild!.nodeValue = 'idle';
    tap.root.c(11);
    tap.settle();

    expect(tap.read().notes.map(([, , text]) => text)).toEqual(['page +0 −0 nodes, 2 attributes, 2 text']);
  });

  it('finds a row of a 2000-node page by the lines that added and removed it, and keeps the page to its own share', () => {
    const tap = openTap();
    const { window } = new JSDOM('<main><ul></ul></main>');
    const { document } = window;
    listen(tap, { console: { ...console }, document, MutationObserver: window.MutationObserver });
    const list = document.querySelector('ul')!;
    const rows = (count: number, from: string) =>
      Array.from({ length: count }, (_, at) => Object.assign(document.createElement('li'), { textContent: `Item ${from}${at}` }));

    tap.root.c(10);
    list.append(...rows(2000, 'C'));
    tap.root.c(14);
    list.children[3]!.remove();
    tap.root.c(15);
    list.append(...rows(storyTap.NOTE_LIMIT, 'D'));
    tap.note('said after the flood');
    tap.settle();

    // A note's place says which line it sits on: the last line that opened at or before it.
    const { lines, notes, unnoted } = tap.read();
    const lineOf = (at: number) => lines.findLast(([, , , said]) => said <= at)![2];
    const c3 = notes.flatMap(([, , text], at) => (text.includes('"Item C3"') ? [[lineOf(at), text]] : []));
    expect(c3).toEqual([
      [10, 'dom + li "Item C3"'],
      [14, 'dom − li "Item C3"'],
    ]);
    // The page's lines stop at their share and are counted past it; what the code said still fits.
    const said = notes.map(([, , text]) => text);
    expect(said.filter((text) => text.startsWith('dom ')).length).toBe(storyTap.NOTE_LIMIT);
    expect(unnoted).toBe(2000 + 1 + storyTap.NOTE_LIMIT - storyTap.NOTE_LIMIT);
    expect(said).toContain('said after the flood');
    expect(Math.max(...said.map((text) => text.length))).toBeLessThanOrEqual(storyTap.NOTE_LENGTH);
  });

  it('starts no page watch in a realm with no document', () => {
    const tap = openTap();
    listen(tap, { console: { ...console } });
    tap.root.c(1);
    tap.root.c(2);
    expect(tap.read().notes).toEqual([]);
  });
});
