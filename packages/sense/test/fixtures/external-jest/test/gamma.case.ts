it('keeps what it entered before the module registry was reset', () => {
  const { decide } = require('../src/decide') as typeof import('../src/decide');
  expect(decide('gamma')).toBe('G');
  jest.resetModules();
  const again = require('../src/decide') as typeof import('../src/decide');
  expect(again.decide('beta')).toBe('B');
});
