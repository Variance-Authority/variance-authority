/**
 * Keep the stylesheets a test produced readable until its capture has read them.
 *
 * A capture is taken from an `afterEach`, and an `afterEach` registered in a
 * setup file is the outermost one a run has: every hook the suite itself
 * registered inside a `describe` has already finished. CSS-in-JS teardown lives
 * in exactly those hooks — emotion's test renderer removes every `<style>` tag
 * it inserted, styled-components resets its sheet — so what the outermost hook
 * reads is the page the test produced with the styling taken back off it. The
 * markup still carries the generated class names, nothing matches them, and the
 * baseline is a photograph of unstyled DOM that compares equal to itself
 * forever while telling nobody that the styling was never in the comparison.
 *
 * There is no hook that runs earlier. Ordering is fixed by the framework:
 * inner `afterEach` before outer, and `onTestFinished` after both.
 *
 * Nothing here fights the teardown — it runs, and it is right to run, because
 * the next test is entitled to a clean page. This records style elements as
 * they are inserted and puts the removed ones back for the length of one
 * capture, so the document the capture indexes is the document the test had.
 */

/** Handle over one test's worth of observed style elements. */
export interface RetainedStyles {
  /**
   * Reattach every recorded element that has since been removed.
   *
   * Returns the undo. Call it once the capture has read the document, so the
   * page is left exactly as the teardown left it.
   */
  restore(): () => void;

  /** Stop observing. Call once per test, after the capture. */
  stop(): void;
}

const NOTHING_RETAINED: RetainedStyles = {
  restore: () => () => {},
  stop: () => {},
};

/**
 * Record `<style>` elements inserted into `target` from now until `stop`.
 *
 * Install this from a `beforeEach` in the same setup file as the capture: the
 * outermost `beforeEach` runs before every hook a suite registers, which is the
 * mirror image of the ordering that loses the styling in the first place.
 *
 * A document whose environment has no `MutationObserver` retains nothing and
 * says so by doing nothing: the capture is then exactly as good as it was.
 */
export function retainStyles(target: Document): RetainedStyles {
  const view = target.defaultView;
  if (!view || typeof view.MutationObserver !== 'function') return NOTHING_RETAINED;

  // Insertion order, which is cascade order for two rules of equal specificity.
  // A Set because a node moved between parents is announced twice and is still
  // one element, and re-adding it would restore it twice.
  const seen = new Set<HTMLStyleElement>();
  const homeOf = new Map<HTMLStyleElement, Node>();

  const observer = new view.MutationObserver((records) => {
    for (const record of records) {
      for (const node of Array.from(record.addedNodes)) {
        if (!isStyleElement(node)) continue;
        seen.add(node);
        if (record.target) homeOf.set(node, record.target);
      }
    }
  });
  observer.observe(target, { childList: true, subtree: true });

  return {
    restore: () => {
      // `takeRecords` because the teardown that removed these tags and the
      // capture that wants them back are in the same task: the observer's
      // callback is a microtask and has not run yet, so without this the
      // elements inserted by the last render are not in `seen` at all.
      observer.takeRecords().forEach((record) => {
        for (const node of Array.from(record.addedNodes)) {
          if (!isStyleElement(node)) continue;
          seen.add(node);
          if (record.target) homeOf.set(node, record.target);
        }
      });

      const returned: HTMLStyleElement[] = [];
      for (const element of seen) {
        if (element.isConnected) continue;
        const home = homeOf.get(element) ?? target.head;
        if (!home.isConnected) continue;
        home.appendChild(element);
        returned.push(element);
      }

      return () => {
        for (const element of returned) element.remove();
      };
    },
    stop: () => {
      observer.disconnect();
      seen.clear();
      homeOf.clear();
    },
  };
}

function isStyleElement(node: Node): node is HTMLStyleElement {
  return node.nodeType === 1 && (node as Element).tagName === 'STYLE';
}
