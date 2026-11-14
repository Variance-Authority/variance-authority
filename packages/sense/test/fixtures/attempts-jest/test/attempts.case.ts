import { total } from '../src/cart';

// Every way a first attempt ends without its body throwing, each followed by a
// second attempt. The runner knows how each ended; the body does not.
jest.retryTimes(1, { logErrorsBeforeRetry: true });
const entered: Record<string, number> = {};
const attempt = (name: string): number => (entered[name] = (entered[name] ?? 0) + 1);

it('answers late and then passes', async () => {
  if (attempt('late') === 1) await new Promise((settle) => setTimeout(settle, 300));
  expect(total([1])).toBe(1);
}, 100);

it('never answers and then passes', async () => {
  if (attempt('never') === 1) await new Promise(() => {});
  expect(total([1])).toBe(1);
}, 100);

it('fails through done and then passes', (done) => {
  const mine = attempt('done');
  setTimeout(() => {
    try {
      expect(total([mine])).toBe(2);
      done();
    } catch (failed) {
      done(failed);
    }
  }, 5);
});

describe('hooked', () => {
  afterEach(() => {
    if (attempt('hook') === 1) throw new Error('afterEach failed once');
  });
  it('fails in afterEach and then passes', () => {
    expect(total([1])).toBe(1);
  });
});

it('fails twice', () => {
  expect(total([attempt('twice')])).toBe(99);
});

// One name, two declarations: the report cannot say which of them was retried.
it('twin', () => {
  expect(total([attempt('twin')])).toBe(2);
});
it('twin', () => {
  expect(total([1])).toBe(1);
});

it('runs once', () => {
  expect(total([1])).toBe(1);
});

it('waits for the late answer', async () => {
  await new Promise((settle) => setTimeout(settle, 400));
});
