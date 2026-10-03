/**
 * Where a `variancePrecondition` call stands in a Playwright worker.
 *
 * The worker runs one test at a time, and `test.info()` names it in the body
 * and in every hook. Which hook is running Playwright knows and does not
 * publish: `_currentHookType` is read, and a worker without it places no call,
 * because a call it cannot tell from a `beforeAll`'s is not guessed to be the
 * body's.
 */

import { test, type TestInfo } from '@playwright/test';
import type { PreconditionStanding } from '@variance-authority/sense/journal';
import { caseKey, testOf } from './test-coordinate.js';

/**
 * Where a call stands, asked at the moment it is made.
 *
 * @param owner The file a test's case is filed under, as the recorder spells it.
 */
export function playwrightStanding(owner: (testInfo: TestInfo) => string): () => PreconditionStanding {
  return () => {
    let info: TestInfo;
    try {
      info = test.info();
    } catch {
      return { at: 'outside', because: 'ran outside a running test' };
    }
    const hookType = (info as { _currentHookType?: unknown })._currentHookType;
    if (typeof hookType !== 'function') {
      return { at: 'outside', because: 'ran in a Playwright worker that does not say which hook is running' };
    }
    const key = caseKey(owner(info), testOf(info).id);
    const hook = (hookType as () => string | undefined).call(info);
    switch (hook) {
      case undefined:
        return bodyOrModifier(info, key);
      case 'beforeEach':
        // FIXME: the depth of the describe that declared the hook — needs the
        // hook's location; every `beforeEach` of a case reads as its innermost
        // describe's, so one at the top of the file and one inside a describe
        // that say the same name are a contradiction rather than an override.
        return { at: 'beforeEach', key, depth: testOf(info).name.split(' > ').length - 1 };
      case 'afterEach':
        return { at: 'after' };
      default:
        return { at: 'outside', because: `ran in a ${hook}, which runs for no one test` };
    }
  };
}

/** The modifiers that take a callback, which Playwright runs before the case to decide how it runs. */
const MODIFIERS: ReadonlySet<unknown> = new Set(['skip', 'fixme', 'fail', 'slow']);

/**
 * Where a call stands when `_currentHookType` names no hook: the body, or a
 * modifier's callback, which it reports the same way.
 *
 * A modifier decides whether the case runs, so it arranges nothing for it.
 * Which one is running is the worker's timeout slot, and a worker that does
 * not say so places no call, as one without `_currentHookType` does.
 *
 * A test fixture the modifier asks for first is set up under the modifier's
 * slot, with the fixture on the running runnable. Its call stays on the case,
 * as it does when the case body asks for the fixture first.
 */
function bodyOrModifier(info: TestInfo, key: string): PreconditionStanding {
  const slots = (info as { _timeoutManager?: { currentSlotType?: unknown; _running?: { runnable?: { fixture?: unknown } } } })
    ._timeoutManager;
  const slot = typeof slots?.currentSlotType === 'function' ? (slots.currentSlotType as () => unknown).call(slots) : undefined;
  // FIXME: Playwright tears test fixtures down under the `test` slot too, so a
  // call in a fixture's cleanup lands on its case; spec 0093 throws for a cleanup.
  if (slot === 'test') return { at: 'case', key };
  // FIXME: a worker fixture a worker-only modifier sets up passes here too and
  // lands on the case about to run; the setup description carries no scope.
  if (MODIFIERS.has(slot) && slots?._running?.runnable?.fixture !== undefined) return { at: 'case', key };
  // FIXME: a worker-only modifier that runs first in a fresh worker runs before
  // the recorder is installed, so its call records nothing and throws nothing.
  if (MODIFIERS.has(slot)) {
    return { at: 'outside', because: `ran in a test.${String(slot)} modifier, which decides whether its case runs` };
  }
  return { at: 'outside', because: 'ran in a Playwright worker that does not say whether the case body is running' };
}
