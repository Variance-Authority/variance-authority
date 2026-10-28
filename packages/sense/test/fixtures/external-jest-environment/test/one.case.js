const { read } = require('../src/shared');
test('records the VM after the host environment', () => {
  expect(global.environmentValue).toBe('host');
  expect(read('case')).toBe('test');
});
