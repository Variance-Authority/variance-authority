// compass: variance-authority.reach.crossings
/**
 * The page's own code: it inflates the record it carries, opens it, and draws
 * the tab or the thing its address names. It asks the network for nothing.
 */

import './view-buffer.js';
import './view-no-node.js';
import type { History } from './view-history-tables.js';
import type { RanOn } from './view-machines.js';
import { openRecord } from './view-record.js';
import { panesOf, type Panes, type Tab } from './view-panes.js';
import { tableOf, written } from './view-table.js';
import type { Cell, Column, Detail, Table } from './view-rows.js';

const made = (tag: string, className = '', text = ''): HTMLElement => {
  const element = document.createElement(tag);
  element.className = className;
  element.textContent = text;
  return element;
};

/** The record in the page: base64 of gzip. */
async function carried(): Promise<Uint8Array> {
  const packed = Uint8Array.from(atob(document.getElementById('recording')!.textContent!), (letter) => letter.charCodeAt(0));
  const plain = new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(plain).arrayBuffer());
}

/** The JSON the page carries at `id`, where `variance view` read it. */
function carriedJson<T>(id: string): T | undefined {
  const held = document.getElementById(id)?.textContent;
  return held === undefined || held === null ? undefined : (JSON.parse(held) as T);
}

function factList(facts: readonly (readonly [string, Cell, Column['as']?])[]): HTMLElement {
  const list = made('dl', 'facts');
  for (const [name, value, as] of facts) {
    if (value !== undefined) list.append(made('dt', '', name), made('dd', '', written(value, as)));
  }
  return list;
}

function shownTables(tables: readonly Table[]): HTMLElement[] {
  return tables.map((table) => (table.count === 0 ? made('p', 'empty', `${table.label}: none${table.hint === '' ? '' : ` (${table.hint})`}`) : tableOf(table)));
}

function draw(panes: Panes, main: HTMLElement): void {
  const [kind = '', ...rest] = location.hash.slice(1).split('/');
  const key = decodeURIComponent(rest.join('/'));
  const tab: Tab | undefined = panes.tabs.find(({ id }) => id === kind);
  const detail: Detail | undefined = tab === undefined && kind !== '' ? panes.detail(kind, key) : undefined;
  const shown = tab ?? (kind === '' ? panes.tabs[0] : undefined);
  document.querySelectorAll('.tabs a').forEach((link) => link.setAttribute('aria-current', link.getAttribute('href') === `#${shown?.id}` ? 'page' : 'false'));
  if (shown !== undefined) main.replaceChildren(factList(shown.facts()), ...shownTables(shown.tables()));
  else if (detail !== undefined) main.replaceChildren(made('h1', 'title', detail.title), factList(detail.facts), ...shownTables(detail.tables));
  else main.replaceChildren(made('p', 'empty', `The record holds nothing at ${kind}/${key}.`));
  scrollTo(0, 0);
}

async function open(): Promise<void> {
  const main = document.querySelector('main')!;
  const suite = document.body.dataset['suite'] ?? '';
  const panes = panesOf(openRecord(await carried(), carriedJson<RanOn>('ran')), suite, carriedJson<History>('history'));
  document.querySelector('.tabs')!.replaceChildren(
    ...panes.tabs.map(({ id, label }) => {
      const link = made('a', '', label) as HTMLAnchorElement;
      link.href = `#${id}`;
      return link;
    }),
  );
  addEventListener('hashchange', () => draw(panes, main));
  draw(panes, main);
  document.body.dataset['opened'] = 'yes';
}

open().catch((error: unknown) => {
  document.querySelector('main')!.replaceChildren(made('p', 'empty', `The record could not be opened: ${String(error)}`));
  document.body.dataset['opened'] = 'no';
});
