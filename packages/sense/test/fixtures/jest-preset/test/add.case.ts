const { add } = require('../src/add.ts');

it('adds', () => {
  const sum: number = add(1, 2);
  expect(sum).toBe(3);
});
