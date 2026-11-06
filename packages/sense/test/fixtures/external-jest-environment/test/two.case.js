test('keeps the cached environment inputs', () => {
  expect(global.environmentValue).toBe('host');
});
