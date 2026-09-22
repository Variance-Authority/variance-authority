const { decide } = require('../src/decide');

test('records the branch it enters', () => {
  expect(decide('record')).toBe('recorded');
});

