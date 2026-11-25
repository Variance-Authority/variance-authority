// compass: variance-authority.reach.crossings
/**
 * A table drawn in the page: only the rows on screen are elements, so a record
 * of any size scrolls, sorts and filters whole.
 */

import type { Cell, Column, Table } from './view-rows.js';

const ROW = 26;
/** Taller than this and some browsers stop placing elements; past it the scroll is scaled. */
const TALLEST = 8_000_000;
const SPARE = 8;

/** How a cell is written. */
export function written(value: Cell, as?: Column['as']): string {
  if (value === undefined) return '';
  if (typeof value === 'number' && as === 'ms') return value >= 1000 ? `${(value / 1000).toFixed(2)} s` : `${Math.round(value * 100) / 100} ms`;
  if (typeof value === 'number' && as === 'time') return new Date(value).toISOString().replace('T', ' ').slice(0, 19);
  return typeof value === 'number' ? value.toLocaleString('en-US') : value;
}

/**
 * What each row of `table` says, in lower case, for the filter: a number by its
 * digits, which is how it is typed, and written once, when a row is first searched.
 */
export function saidBy(table: Table): (row: number) => string {
  const held: string[] = [];
  return (row) => {
    let said = held[row];
    if (said === undefined) {
      said = '';
      for (const column of table.columns) {
        const value = column.at(row);
        if (value !== undefined) said += `${value}\n`;
      }
      held[row] = said = said.toLowerCase();
    }
    return said;
  };
}

/** The rows of `order` whose text holds `needle`, in `order`'s order. */
export function matching(said: (row: number) => string, order: readonly number[], needle: string): number[] {
  const wanted = needle.toLowerCase();
  return wanted === '' ? [...order] : order.filter((row) => said(row).includes(wanted));
}

/** Rows ordered by one column, absent values last in either direction. */
export function sorted(table: Table, rows: readonly number[], column: number, down: boolean): number[] {
  const { at } = table.columns[column]!;
  const keyed = rows.map((row) => ({ row, key: at(row) }));
  const way = down ? -1 : 1;
  keyed.sort((a, b) => {
    if (a.key === undefined || b.key === undefined) return a.key === b.key ? a.row - b.row : a.key === undefined ? 1 : -1;
    if (a.key === b.key) return a.row - b.row;
    return (a.key < b.key ? -1 : 1) * way;
  });
  return keyed.map(({ row }) => row);
}

const element = (tag: string, className: string): HTMLElement => {
  const made = document.createElement(tag);
  made.className = className;
  return made;
};

/** Whether a column is numbers: a duration or an instant, or a number in its first row. */
const numeric = (column: Column): boolean => column.as !== undefined || typeof column.at(0) === 'number';

/** `table` in an element of its own. */
export function tableOf(table: Table): HTMLElement {
  const box = element('section', 'part');
  const head = element('h2', '');
  head.textContent = `${table.label} `;
  const count = element('span', 'count');
  head.append(count);
  const hint = element('p', 'hint');
  hint.textContent = table.hint;
  const filter = element('input', 'vfilter') as HTMLInputElement;
  filter.type = 'search';
  filter.placeholder = `filter ${table.label.toLowerCase()}`;
  filter.setAttribute('aria-label', filter.placeholder);
  const grid = element('div', 'grid');
  const template = table.columns.map((column, at) => (column.bar !== undefined ? 'minmax(16rem,3fr)' : column.link !== undefined ? `minmax(12rem,${at === 0 ? 6 : 4}fr)` : 'minmax(4rem,1fr)')).join(' ');
  const header = element('div', 'row head');
  header.style.gridTemplateColumns = template;
  const scroll = element('div', 'scroll');
  const body = element('div', 'body');
  scroll.append(body);
  grid.append(header, scroll);
  box.append(head, hint, ...(table.count > 1 ? [filter] : []), grid);

  const said = saidBy(table);
  const all = Array.from({ length: table.count }, (_, row) => row);
  let sortedBy: { column: number; down: boolean } | undefined;
  let rows: readonly number[] = all;

  const draw = (): void => {
    const height = scroll.clientHeight || ROW * 12;
    const full = rows.length * ROW;
    const shown = Math.min(full, TALLEST);
    body.style.height = `${shown}px`;
    const span = Math.max(shown - height, 1);
    const at = full <= TALLEST ? scroll.scrollTop : (scroll.scrollTop / span) * (full - height);
    const first = Math.max(0, Math.floor(at / ROW) - SPARE);
    const last = Math.min(rows.length, Math.ceil((at + height) / ROW) + SPARE);
    const offset = scroll.scrollTop - at;
    body.replaceChildren();
    for (let index = first; index < last; index += 1) {
      const line = rowOf(table, rows[index]!, template);
      line.style.transform = `translateY(${index * ROW + offset}px)`;
      body.append(line);
    }
    grid.style.setProperty('--shown', String(Math.min(rows.length, 18)));
    count.textContent = rows.length === table.count ? table.count.toLocaleString('en-US') : `${rows.length.toLocaleString('en-US')} of ${table.count.toLocaleString('en-US')}`;
  };
  const refresh = (): void => {
    rows = matching(said, sortedBy === undefined ? all : sorted(table, all, sortedBy.column, sortedBy.down), filter.value.trim());
    scroll.scrollTop = 0;
    draw();
  };
  table.columns.forEach((column, at) => {
    const name = element('button', numeric(column) ? 'col num' : 'col') as HTMLButtonElement;
    name.type = 'button';
    name.textContent = column.name;
    name.title = column.name;
    name.addEventListener('click', () => {
      sortedBy = { column: at, down: sortedBy?.column === at ? !sortedBy.down : numeric(column) };
      header.querySelectorAll('.col').forEach((other, index) => other.classList.toggle('asc', index === at && !sortedBy!.down));
      header.querySelectorAll('.col').forEach((other, index) => other.classList.toggle('desc', index === at && sortedBy!.down));
      refresh();
    });
    header.append(name);
  });
  filter.addEventListener('input', refresh);
  scroll.addEventListener('scroll', () => requestAnimationFrame(draw));
  // The table is measured once it is on the page, and again whenever it is shown.
  new ResizeObserver(draw).observe(scroll);
  draw();
  return box;
}

function rowOf(table: Table, row: number, template: string): HTMLElement {
  const line = element('div', 'row');
  line.style.gridTemplateColumns = template;
  for (const column of table.columns) {
    const cell = element('div', 'cell');
    const bar = column.bar?.(row);
    const value = written(column.at(row), column.as);
    const link = column.link?.(row);
    if (bar !== undefined) {
      const track = element('div', 'track');
      track.title = bar.title;
      const drawn = element('div', 'bar');
      drawn.style.cssText = `left:${bar.left}%;width:max(2px,${bar.width}%)`;
      for (const part of bar.parts) {
        const slice = element('i', `ph ${part.name}`);
        slice.style.width = `${part.share}%`;
        drawn.append(slice);
      }
      track.append(drawn);
      cell.append(track);
    } else if (link !== undefined && value !== '') {
      const go = element('a', 'go') as HTMLAnchorElement;
      go.href = `#${link}`;
      go.textContent = value;
      cell.title = value;
      cell.append(go);
    } else {
      const plain = element('span', '');
      plain.textContent = value;
      cell.title = value;
      cell.append(plain);
    }
    if (value.includes('/')) cell.classList.add('path');
    if (column.as !== undefined || typeof column.at(row) === 'number') cell.classList.add('num');
    line.append(cell);
  }
  return line;
}
