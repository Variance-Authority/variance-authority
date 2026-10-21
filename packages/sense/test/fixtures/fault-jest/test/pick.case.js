const { checked, unchecked } = require('../src/pick.js');

it('checks what checked returns', () => {
  expect(checked(1)).toBe('positive');
});

it('runs unchecked and checks nothing', () => {
  unchecked([], 1);
});
