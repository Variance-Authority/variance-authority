import { total } from '../src/cart';

// Every way a first attempt ends without its body throwing, each followed by a
// second attempt. The runner knows how each ended; the body does not.
const entered: Record<string, number> = {};
const attempt = (name: string): number => (entered[name] = (entered[name] ?? 0) + 1);

it('answers late and then passes', { retry: 1, timeout: 100 }, async () => {
  if (attempt('late') === 1) await new Promise((settle) => setTimeout(settle, 300));
  expect(total([1])).toBe(1);
});

it('never answers and then passes', { retry: 1, timeout: 100 }, async () => {
  if (attempt('never') === 1) await new Promise(() => {});
  expect(total([1])).toBe(1);
});

it('fails twice', { retry: 1 }, () => {
  expect(total([attempt('twice')])).toBe(99);
});

// One name, two declarations: the report cannot say which of them was retried.
it('twin', { retry: 1 }, () => {
  expect(total([attempt('twin')])).toBe(2);
});
it('twin', () => {
  expect(total([1])).toBe(1);
});

// Two repeats, each failing once: Rstest counts two retries and numbers both
// failures 0, so its report cannot say which run was which attempt.
it('fails once in each repeat', { repeats: 1, retry: 1 }, () => {
  expect(total([attempt('repeat') % 2])).toBe(0);
});

it('runs once', () => {
  expect(total([1])).toBe(1);
});

it('waits for the late answer', async () => {
  await new Promise((settle) => setTimeout(settle, 400));
});
