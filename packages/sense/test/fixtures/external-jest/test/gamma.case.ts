it('keeps what it entered before the module registry was reset', () => {
  const { decide } = require('../src/decide') as typeof import('../src/decide');
  expect(decide('gamma')).toBe('G');
  jest.resetModules();
  const again = require('../src/decide') as typeof import('../src/decide');
  expect(again.decide('beta')).toBe('B');
  // Evaluated in registries of their own, which the file's registry never lists.
  jest.isolateModules(() => require('../src/decide'));
  jest.createMockFromModule('../src/decide');
});
