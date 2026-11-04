it('counts afresh in each isolated registry', () => {
  let first = 0;
  let second = 0;
  jest.isolateModules(() => {
    first = (require('../src/counter') as typeof import('../src/counter')).next();
  });
  jest.resetModules();
  jest.isolateModules(() => {
    second = (require('../src/counter') as typeof import('../src/counter')).next();
  });
  expect([first, second]).toEqual([1, 1]);
});
