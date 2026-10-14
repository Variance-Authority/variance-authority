import {
  createSubjectRecorder,
  preconditionOf,
  type SubjectRecording,
} from '@variance-authority/sense/journal';
import { READS_ATTRIBUTE } from '@variance-authority/reads';
import type { CoveragePrecondition } from '@variance-authority/sense/test-selection';
import type { RouteWorld } from './world.js';

type Page = RouteWorld['page'];

/**
 * What each page of a route run executed and showed, recorded for the next
 * run's selection.
 *
 * A route run reads one page per subject, so a page is its own owner: what its
 * browser drained, what its server reported under its journey, and the files
 * its root says it showed all belong to it and to nothing else.
 */

/** Where a page run's execution evidence is joined, read and kept. */
export type RouteExecutionOptions = SubjectRecording;


export interface RouteRecorder {
  /**
   * Put the journey this subject's reading runs under on the page's context.
   *
   * True when it did, which means the reading has to load the page even when
   * the browser is already on its address: the document already there was
   * served under another journey.
   */
  readonly join: (page: Page, subjectId: string, url: string) => Promise<boolean>;
  /**
   * Close one subject's window, with the files its root says it showed.
   * `complete` is false for a page this run refused.
   */
  readonly note: (page: Page, subjectId: string, complete: boolean, roots: readonly string[]) => Promise<void>;
  readonly close: (costs?: ReadonlyMap<string, number>) => Promise<void>;
}

export function createRouteRecorder(options: RouteExecutionOptions): RouteRecorder {
  const recorder = createSubjectRecorder(
    {
      subject: 'page',
      uninstrumented:
        '`tests` is on and no page or head reported what it executed, so this run ' +
        'recorded nothing: build the application with `testSelectionProbes()` from ' +
        '`@variance-authority/sense/journal`, or name the heads that serve it',
    },
    options,
  );

  return {
    join: async (page, subjectId, url) => {
      const cookies = await recorder.join(subjectId, new URL(url).origin);
      if (cookies.length === 0) return false;
      await page.context().addCookies([...cookies]);
      return true;
    },

    note: async (page, subjectId, complete, roots) => {
      // FIXME: a page whose document never reached a named head (prerendered,
      // a cache hit) keeps a complete row with browser code alone, so a later
      // edit to its server code skips it. A head named and no report under the
      // journey minted for this page should mark the row incomplete.
      const preconditions: CoveragePrecondition[] = [];
      for (const path of await readsOn(page, roots)) {
        // A file the page names and the checkout does not hold has no digest to
        // compare; the edit that adds it is a change no record names, and that
        // runs everything.
        const precondition = await preconditionOf(recorder.root, path);
        if (precondition !== undefined) preconditions.push(precondition);
      }
      await recorder.note(page, subjectId, complete, preconditions.length === 0 ? {} : { preconditions });
    },

    close: recorder.close,
  };
}

/**
 * The files the subject's root says it showed, from the root the page agent
 * reads: the first of `roots` the document holds.
 *
 * A page that never became ready may hold none of them, and then it said
 * nothing.
 */
async function readsOn(page: Page, roots: readonly string[]): Promise<readonly string[]> {
  try {
    return await page.evaluate(
      ({ roots, attribute }) => {
        let root: Element | null = null;
        for (const selector of roots) {
          root = document.querySelector(selector);
          if (root !== null) break;
        }
        if (root === null) return [];
        const paths = new Set<string>();
        for (const element of [root, ...root.querySelectorAll(`[${attribute}]`)]) {
          for (const path of (element.getAttribute(attribute) ?? '').split(/\s+/)) {
            if (path !== '') paths.add(path);
          }
        }
        return [...paths].sort();
      },
      { roots, attribute: READS_ATTRIBUTE },
    );
  } catch {
    // A page that navigated away or closed under the reading said nothing more.
    return [];
  }
}
