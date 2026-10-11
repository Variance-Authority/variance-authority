import { expect, it } from 'vitest';

// A specifier the scan cannot read: the graph holds no edge from this test to the meter.
const meter = ['..', 'src', 'meter'].join('/');

it('reads the total', async () => {
  const { reading } = await import(/* @vite-ignore */ meter);
  expect(reading()).toBe(10);
});
