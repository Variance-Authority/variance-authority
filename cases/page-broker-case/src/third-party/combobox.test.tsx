// @vitest-environment jsdom
import { Combobox, ComboboxInput, ComboboxOption, ComboboxOptions } from '@headlessui/react';
import { broker, leads } from '@variance-authority/page-broker';
import { surface } from '@variance-authority/page-broker/dom';
import { act, createElement as h, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** A fruit picker built from Headless UI's combobox, which this repository did not write. */
function FruitPicker() {
  const [query, setQuery] = useState('');
  const [chosen, choose] = useState<string | null>(null);
  const shown = ['Apple', 'Banana', 'Cherry'].filter((fruit) =>
    fruit.toLowerCase().includes(query.toLowerCase()),
  );
  return h(
    'div',
    null,
    h(
      Combobox<string | null>,
      { value: chosen, onChange: choose, onClose: () => setQuery('') },
      h(ComboboxInput, { 'aria-label': 'Fruit', onChange: (event) => setQuery(event.target.value) }),
      h(
        ComboboxOptions,
        null,
        shown.map((fruit) => h(ComboboxOption, { key: fruit, value: fruit }, fruit)),
      ),
    ),
    query && shown.length === 0 ? h('p', null, 'No fruit found') : null,
    chosen ? h('p', { role: 'status' }, `Chosen: ${chosen}`) : null,
  );
}

const Chosen = broker('chosen', { probe: { role: 'status' } });

// Headless UI keeps an empty listbox open when no option matches, so an option marks the find.
const Options = broker('options', {
  probe: { role: 'option' },
  actions: {
    pick: leads({ chosen: Chosen }, (on, fruit: string) => on.click({ role: 'option', name: fruit })),
  },
});

const Nothing = broker('nothing', { probe: { text: 'No fruit found' } });

const Picker = broker('picker', {
  probe: { role: 'combobox', name: 'Fruit' },
  actions: {
    search: leads({ found: Options, nothing: Nothing }, (on, words: string) =>
      on.fill({ role: 'combobox', name: 'Fruit' }, words),
    ),
  },
});

describe('a third-party combobox, over a document', () => {
  let root: Root;
  beforeEach(() => {
    // jsdom lays nothing out, and Headless UI watches its list's size all the same.
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const host = document.body.appendChild(document.createElement('div'));
    root = createRoot(host);
    act(() => root.render(h(FruitPicker)));
  });
  afterEach(() => {
    act(() => root.unmount());
    document.body.replaceChildren();
    vi.unstubAllGlobals();
  });

  it('finds the options its words match, and picks one', async () => {
    const picker = await Picker.on(surface(document));
    const options = await picker.search('an').to('found');
    await options.pick('Banana').to('chosen');
    expect(document.querySelector('[role=status]')?.textContent).toBe('Chosen: Banana');
  });

  it('reports finding nothing for words no option holds', async () => {
    const on = surface(document);
    const picker = await Picker.on(on);
    expect(await picker.search('kiwi')).toMatchObject({ outcome: 'nothing' });
    await expect(Options.on(on)).rejects.toThrow('options: not on the page');
  });
});
