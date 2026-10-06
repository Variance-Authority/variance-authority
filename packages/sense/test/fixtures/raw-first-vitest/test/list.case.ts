import { expect, it } from 'vitest';

const JSX_SOURCE = Symbol.for('@variance-authority/jsx-source');

interface Element {
  readonly props: Record<string | symbol, unknown> & { readonly children?: unknown };
}

const lineOf = (element: Element): unknown => (element.props[JSX_SOURCE] as { line: number } | undefined)?.line;

it('renders through the probes, registers the component, and keeps the lines the author wrote', async () => {
  const registered: string[] = [];
  Object.assign(globalThis, { $RefreshReg$: (_type: unknown, name: string) => registered.push(name) });
  const { List } = await import('../src/list.tsx');
  expect(registered).toEqual(['List']);

  const empty = List({ items: [], empty: 'none' }) as Element;
  expect(lineOf(empty)).toBe(3);
  const placeholder = empty.props.children as Element;
  expect(placeholder.props.children).toBe('none');
  expect(lineOf(placeholder)).toBe(5);

  const full = List({ items: ['a', 'b'], empty: 'none' }) as Element;
  const rows = full.props.children as readonly Element[];
  expect(rows.map((row) => row.props.children)).toEqual(['A', 'B']);
  expect(rows.map(lineOf)).toEqual([7, 7]);
});
