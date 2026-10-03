import { variancePrecondition } from '@variance-authority/sense/precondition';
import { total } from '../src/cart';

// Every call here is made where no case is running, so each one throws, and
// the case below reads what was thrown.

const thrown = (call: () => void): string => {
  try {
    call();
  } catch (error) {
    return String(error);
  }
  return 'nothing thrown';
};

const atTop = thrown(() => variancePrecondition({ top: true })); // at the top

describe('outside', () => {
  const inDescribe = thrown(() => variancePrecondition({ described: true })); // in a describe
  let inBeforeAll = 'never ran';
  beforeAll(() => {
    inBeforeAll = thrown(() => variancePrecondition({ 'before all': true })); // in a beforeAll
  });

  it('throws at the top level, in a describe callback and in a beforeAll', () => {
    expect(atTop).toMatch(/variancePrecondition at \S+ ran outside a running case/);
    expect(inDescribe).toMatch(/variancePrecondition at \S+ ran outside a running case/);
    expect(inBeforeAll).toMatch(/variancePrecondition at \S+ ran in a beforeAll/);
    expect(total([1])).toBe(1);
  });
});

// Printed rather than thrown, so the file's recording is still written.
afterAll(() => {
  console.log(thrown(() => variancePrecondition({ 'after all': true }))); // in an afterAll
});
