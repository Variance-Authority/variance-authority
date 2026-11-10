const { setting } = require('../src/default-setting');
test('reads a module Jest\'s default transformer compiled', () => {
  expect(setting()).toBe('default');
});
