import type { TestEnvironmentRequest } from './preview-protocol.js';

/**
 * Storybook's fixed wait, switched off for the document a session drives.
 *
 * Every story Storybook renders waits 100 ms in its `completing` phase before
 * it even asks whether anything is animating, unless it believes a test runner
 * is in charge. A session switches stories in one document, so that wait is a
 * floor under every story after the first, and it buys nothing: the capture
 * waits for its own signals, and the animation state it records is the
 * stabilize recipe's, not Storybook's. `preview-protocol.ts` says why the switch
 * is the global and not the user agent, and what the test branch does instead.
 *
 * Serialized to source text and evaluated in page scope, so it may close over
 * nothing and import nothing but types; every constant arrives in the argument.
 */

/**
 * Put this document on Storybook's test branch. **Runs in page scope.**
 *
 * Once per document. The observer outlives the call because the sheet it
 * removes is appended later, by every render after this one. Its callback runs
 * as a microtask after the script that appended the sheet, so the sheet is gone
 * before the next frame is painted and before `storyRendered` reaches anyone
 * listening for it.
 */
export const enterTestEnvironment = (request: TestEnvironmentRequest): void => {
  const scope = globalThis as unknown as Record<string, unknown>;
  if (scope[request.key] === true) return;
  scope[request.key] = true;
  scope[request.flag] = true;

  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (!(node instanceof HTMLStyleElement)) continue;
        const text = node.textContent ?? '';
        if (request.pauseSheet.every((declaration) => text.includes(declaration))) node.remove();
      }
    }
  });
  observer.observe(document.head, { childList: true });
};
