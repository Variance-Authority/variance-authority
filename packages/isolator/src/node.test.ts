import { expect, it } from 'vitest';
import { isolateConcurrentEach } from './node.js';
import { currentSession } from './session.js';

type Hook = (runTest: () => unknown, context: { task: { concurrent?: boolean } }) => unknown;

const hooked = (): Hook => {
  let registered: Hook | undefined;
  isolateConcurrentEach((hook) => (registered = hook));
  return registered!;
};

it('runs a concurrent test in a session of its own', () => {
  const hook = hooked();
  const outer = currentSession();
  const seen: object[] = [];
  hook(() => seen.push(currentSession()), { task: { concurrent: true } });
  hook(() => seen.push(currentSession()), { task: { concurrent: true } });
  expect(seen[0]).not.toBe(outer);
  expect(seen[1]).not.toBe(seen[0]);
});

it('leaves a test that runs alone in the session its `beforeEach` reset started', () => {
  const hook = hooked();
  const outer = currentSession();
  let seen: object | undefined;
  hook(() => (seen = currentSession()), { task: {} });
  expect(seen).toBe(outer);
});
