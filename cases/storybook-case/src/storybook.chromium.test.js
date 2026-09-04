import { createServer } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { chromium } from 'playwright';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { collectStories, parseStoryIndex, toSubjects } from '@variance-authority/storybook';

/**
 * The adapter, against a Storybook it did not author.
 *
 * Every other test of `@variance-authority/storybook` runs on fixtures written
 * to match the format as documented. A fixture agrees with whoever wrote it, so
 * it can only ever confirm that the reader and the writer share a belief. This
 * file builds a real Storybook, serves the real `storybook-static` output, and
 * drives the real preview — which is the only arrangement in which the reader
 * can be wrong.
 *
 * The stories are chosen so the adapter meets the cases that separate tools
 * rather than the case every tool handles. A static button proves nothing. What
 * is asserted here is the behaviour around subjects that are still moving when
 * the capture arrives: that a component which settles late and says so is
 * captured settled, and that a configured promise of readiness which is not kept
 * fails loudly instead of being answered with weaker evidence.
 *
 * Skipped, loudly, when the Storybook has not been built. Run:
 *   yarn workspace @variance-authority/case-storybook build-storybook
 */

const STATIC_DIR = join(process.cwd(), 'cases', 'storybook-case', 'storybook-static');
const READY = '[data-testid="case-ready"]';

const BUILT = existsSync(join(STATIC_DIR, 'index.json'));
const BROWSER_AVAILABLE = (() => {
  try {
    return existsSync(chromium.executablePath());
  } catch {
    return false;
  }
})();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
};

/**
 * A static server rather than `file://`.
 *
 * Storybook's preview fetches its own index and lazily imports story chunks, and
 * both are blocked by the file-protocol origin rules — so a `file://` run would
 * fail for a reason that has nothing to do with the adapter and would look like
 * a defect in it.
 */
function serveStatic(root) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0]);
    const resolved = join(root, normalize(path === '/' ? '/index.html' : path));

    if (!resolved.startsWith(root) || !existsSync(resolved)) {
      response.writeHead(404).end('not found');
      return;
    }

    response.writeHead(200, { 'content-type': TYPES[extname(resolved)] ?? 'application/octet-stream' });
    response.end(readFileSync(resolved));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

let server;
let browser;
let page;
let baseUrl = '';
let index;

beforeAll(async () => {
  if (!BUILT || !BROWSER_AVAILABLE) return;

  ({ server } = await serveStatic(STATIC_DIR).then((started) => {
    baseUrl = `http://127.0.0.1:${started.port}`;
    return started;
  }));

  index = parseStoryIndex(JSON.parse(readFileSync(join(STATIC_DIR, 'index.json'), 'utf8')));

  browser = await chromium.launch({ headless: true });
  page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
}, 120_000);

afterAll(async () => {
  await browser?.close();
  await new Promise((resolve) => (server ? server.close(resolve) : resolve(undefined)));
});

const live = BUILT && BROWSER_AVAILABLE ? describe : describe.skip;

// One line per unmet precondition. A single line covering two reasons sends a
// reader to fix whichever one they guess.
if (!BUILT || !BROWSER_AVAILABLE) {
  console.warn(
    '\ncases/storybook-case (storybook): skipped.' +
      (BROWSER_AVAILABLE ? '' : '\n  no browser — npx playwright install chromium') +
      (BUILT
        ? ''
        : '\n  no Storybook — yarn workspace @variance-authority/case-storybook build-storybook') +
      '\n',
  );
}

live('reading a Storybook nobody wrote for us', () => {
  it('parses the real index and finds every story', () => {
    // The format the fixtures model, produced by the tool itself. A version bump
    // that moved a field would surface here and nowhere else.
    expect(index.shape).toBe('entries');
    expect(index.stories.length).toBeGreaterThanOrEqual(8);
    expect(index.stories.map((story) => story.id)).toContain('case-surface--button-primary');
  });

  it('maps stories to subjects without a fixture in the loop', () => {
    const plan = toSubjects(index);
    expect(plan.subjects.length).toBe(index.stories.length);
    expect(plan.subjects.every((entry) => entry.subject.id.length > 0)).toBe(true);
  });

  it('renders every stable story through one page and one navigation', async () => {
    // The economics ADR-0009 asserts, exercised against a real preview: stories
    // share a session, and moving between them must not reload the iframe.
    const stable = index.stories
      .filter((story) => !story.id.includes('deferred') && !story.id.includes('ticking'))
      .map((story) => story.id);

    const outcomes = await collectStories(page, stable, { baseUrl });
    const failed = outcomes.filter((outcome) => outcome.status !== 'rendered');

    expect(failed.map((outcome) => `${outcome.storyId}: ${outcome.status}`)).toEqual([]);

    // One navigation for the whole set is the saving ADR-0009 rests on.
    expect(outcomes.filter((outcome) => outcome.navigated)).toHaveLength(1);
  }, 120_000);
});

live('a story whose subject only exists after its play function', () => {
  it('captures what the interaction produced, not what rendered before it', async () => {
    // The Chromatic-parity claim, measured rather than read off Storybook's
    // source. `Revealed` renders a closed panel and its play function opens it,
    // so a capture taken at render time would be of a page that is not what the
    // story is about — and would look entirely correct.
    //
    // Nothing in this project runs the play function: Storybook's preview does,
    // and the phase order is `playing` → `completed` → `storyRendered`, so
    // waiting on `storyRendered` is already waiting on the interaction. What is
    // asserted here is that this remains true through a real preview, a real
    // channel and a real component.
    let markup = '';
    const [outcome] = await collectStories(page, ['case-surface--revealed'], {
      baseUrl,
      observe: async () => {
        markup = await page.evaluate(() => document.querySelector('#storybook-root')?.innerHTML ?? '');
      },
    });

    expect(outcome.status).toBe('rendered');
    expect(markup).toContain('Shipping to Wollongong');
  }, 60_000);
});

live('a subject that settles after the framework says it is done', () => {
  it('captures the skeleton when readiness comes from the framework', async () => {
    // Not a bug being demonstrated — a limit. `storyRendered` fires when the
    // story function returns, which for a component that defers work is before
    // the component exists. The capture is reproducible and wrong, which is far
    // more dangerous than a capture that is merely flaky.
    let markup = '';
    await collectStories(page, ['case-surface--deferred'], {
      baseUrl,
      observe: async () => {
        markup = await page.evaluate(() => document.querySelector('#storybook-root')?.innerHTML ?? '');
      },
    });

    expect(markup).toContain('loading');
  }, 60_000);

  it('captures the component when the subject declares readiness itself', async () => {
    // The same story, the same page, one option different. This is the whole
    // argument for the marker: the framework cannot know, and the component can.
    let markup = '';
    const [outcome] = await collectStories(page, ['case-surface--deferred'], {
      baseUrl,
      readySelector: READY,
      observe: async () => {
        markup = await page.evaluate(() => document.querySelector('#storybook-root')?.innerHTML ?? '');
      },
    });

    expect(outcome.readiness).toBe('declared');
    expect(markup).not.toContain('loading');
    expect(markup).toContain('Grace');
  }, 60_000);

  it('fails loudly when a promised marker never arrives', async () => {
    // The property that makes the option worth having. A story that does not
    // attach the marker must not be captured on weaker evidence — a contract
    // that quietly degrades to a guess reads as satisfied and is not.
    const [outcome] = await collectStories(page, ['case-surface--button-primary'], {
      baseUrl,
      readySelector: '[data-testid="never-attached"]',
      timeoutMs: 2_000,
    });

    expect(outcome.status).toBe('timeout');
    expect(outcome.readiness).not.toBe('markup-quiescent');
    expect(outcome.readiness).not.toBe('storyRendered');
    expect(JSON.stringify(outcome)).toContain('never-attached');
  }, 60_000);
});

// Top level on purpose: `live` is `describe.skip` without a build or a browser,
// and a todo inside a skipped block is counted as skipped rather than as a gap.

it.todo(
  'a story whose image bytes change behind an unchanged URL is reported `changed` rather than `unchanged` — the scoped network keys and the document-digest carry are asserted over the route path in `packages/route-collector/src/network.chromium.test.ts`, and the Storybook path runs the same page agent and the same narrowing, so this needs one real story collected here through `@variance-authority/storybook-collector` behind an asset whose bytes moved',
);

it.todo(
  'the three options this collector forwards — `hashAssets`, `wiring` and `holdings` — do to a story what they do to a route, where `packages/route-collector/src/wiring.chromium.test.ts` and `packages/route-collector/src/network.chromium.test.ts` assert them against the same page agent and the same `observeNetwork`; needs one story collected here whose component holds state behind an asset the wire serves, which is one mount for all three',
);

it.todo(
  'no rule from Storybook’s own chrome — the addon layout, the error overlay, the toolbar — reaches a story’s snapshot, read off `styleProvenance[].selector` against the sheets a real Storybook ships rather than the fixture copy in `packages/dom/src/collect.test.ts` — needs one story collected through `@variance-authority/storybook-collector` here; the preview reset is a separate question, since ADR-0028 admits a rule that matches an ancestor of the subject and the reset matches `html`',
);
