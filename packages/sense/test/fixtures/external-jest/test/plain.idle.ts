// Imports no source, so a run of this file alone instruments no module.
it('touches nothing of the project', () => {
  expect(1 + 1).toBe(2);
});
