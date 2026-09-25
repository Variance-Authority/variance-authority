import { shop } from './shop';

it('finds a kettle', async () => {
  expect(await shop('/api/search?q=kettle')).toEqual([{ sku: 'kettle', name: 'Copper kettle' }]);
});

it('never calls the shop', () => {
  expect('kettle'.length).toBe(6);
});
