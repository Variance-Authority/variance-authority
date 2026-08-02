/**
 * The collector module `variance.config.json` names — the thirty lines an
 * operator writes, written out in full so the number can be checked.
 *
 * `variance run` supplies the generic half: it reads the built Storybook's
 * `index.json`, applies exclusion policy, and hands the plan in through the
 * context. What is left is the half only this project can do — open its own
 * Storybook, move between stories, and turn each one into a document and a
 * capture.
 *
 * Three decisions in here are the project's rather than the tool's, and each is
 * the kind of thing a plugin API would have had to guess:
 *
 * - **it serves its own build.** Storybook's preview fetches its own index and
 *   lazily imports story chunks, both blocked by `file://` origin rules, so a
 *   static server is required and nothing outside this file knows that.
 * - **it declares its own readiness.** `readySelector` is this project's marker;
 *   a story that never attaches it times out and says which selector it waited
 *   for, rather than being captured on weaker evidence.
 * - **it indexes its own source.** Component→file is a regex scan of this
 *   project's `src/`, which nothing generic could have located.
 */
import { createServer } from 'node:http';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, extname, join, normalize as normalizePath, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { indexSource, mergeSourceIndexes, normalize } from '@variance-authority/core';
import { collectStory, harnessPage, previewUrl } from '@variance-authority/storybook';
import { AGENT, bundle } from './bundle.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');

/**
 * Which stories declare their own readiness, and with what marker.
 *
 * Per story, not per project, and that is the whole design. Storybook's
 * `storyRendered` fires when the story function returns, which for a component
 * that defers work is *before the component exists* — so `AsyncPanel` needs a
 * marker. A button does not, and demanding one from it would time out eight
 * stories to solve a problem one of them has.
 *
 * A map here rather than a story parameter because `index.json` carries tags and
 * titles and not arbitrary parameters, so this is knowledge the operator holds.
 * It is also the honest shape: opting a story in is a decision somebody makes
 * about that component, and a project-wide default would be a guess about all of
 * them.
 */
const READY_SELECTORS = {
  'case-surface--deferred': '[data-testid="case-ready"]',
};

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
};

function serveStatic(root) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent((request.url ?? '/').split('?')[0]);
    const resolved = join(root, normalizePath(path === '/' ? '/index.html' : path));

    if (!resolved.startsWith(root) || !existsSync(resolved)) {
      response.writeHead(404).end('not found');
      return;
    }

    response.writeHead(200, {
      'content-type': TYPES[extname(resolved)] ?? 'application/octet-stream',
    });
    response.end(readFileSync(resolved));
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
  });
}

/** This project's own source, indexed by component name. A regex scan, not a plugin. */
function buildSourceIndex() {
  const directory = join(ROOT, 'src');
  const files = readdirSync(directory).filter(
    (name) => /\.jsx?$/.test(name) && !name.includes('.test.') && !name.includes('.stories.'),
  );

  return mergeSourceIndexes(
    files.map((name) =>
      indexSource(relative(ROOT, join(directory, name)), readFileSync(join(directory, name), 'utf8')),
    ),
  );
}

/**
 * @param {{ config: import('@variance-authority/cli').Config, plan?: unknown }} context
 */
export default async function createCollector(context) {
  const { config, plan } = context;

  // The build the config named, not a sibling this file assumed. `subjects.index`
  // is already an absolute path to `<build>/index.json`, so serving its directory
  // is the only arrangement in which the stories driven and the stories planned
  // are guaranteed to be the same ones — and it is what lets a second build of
  // the same project be pointed at without editing this file.
  const STATIC_DIR = dirname(config.subjects.index);

  if (!existsSync(join(STATIC_DIR, 'index.json'))) {
    throw new Error(
      `${STATIC_DIR} has no index.json; run ` +
        '`yarn workspace @variance-authority/case-storybook build-storybook` first',
    );
  }

  const [source, injected, started] = await Promise.all([
    buildSourceIndex(),
    bundle(),
    serveStatic(STATIC_DIR),
  ]);
  const baseUrl = `http://127.0.0.1:${started.port}`;

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({
    viewport: { width: config.viewport.width, height: config.viewport.height },
    deviceScaleFactor: config.viewport.deviceScaleFactor,
    colorScheme: config.viewport.colorScheme,
  });

  const engine = `chromium@${browser.version()}`;
  let injectedInto = '';

  /**
   * Re-inject after a navigation, and only then.
   *
   * `collectStory` navigates exactly once for a whole run — that is the saving
   * ADR-0009 rests on — so this runs once too. Re-injecting on every story would
   * be harmless and would also hide a second navigation, which is the one thing
   * the outcome's `navigated` flag exists to make visible.
   */
  async function ensureAgent() {
    const url = page.url();
    if (url === injectedInto) return;

    await page.addScriptTag({ content: injected });
    const installed = await page.evaluate(
      (name) => typeof window[name] === 'object',
      AGENT,
    );
    if (!installed) throw new Error(`the page bundle did not install ${AGENT}`);
    injectedInto = url;
  }

  return {
    async plan() {
      if (plan === undefined) {
        throw new Error('this collector expects `subjects.kind: "storybook"`, which supplies a plan');
      }
      return plan;
    },

    async collect(planned) {
      const storyId = planned.subject.id.replace(/^story:/, '');
      const viewport = planned.viewport ?? config.viewport;

      const readySelector = READY_SELECTORS[storyId];
      const outcome = await collectStory(harnessPage({ page }), storyId, {
        baseUrl,
        ...(readySelector !== undefined ? { readySelector } : {}),
      });

      // A story that did not render is a hole in this run's coverage, and it
      // travels as a value rather than an exception: one component that throws
      // must not cost the others their observations, and it must not be silently
      // absent either.
      if (outcome.status !== 'rendered') {
        return {
          ok: false,
          because:
            `the story did not render (${outcome.status}, readiness ${outcome.readiness})` +
            (outcome.error === undefined ? '' : `: ${outcome.error.message}`),
        };
      }

      await ensureAgent();

      const raw = await page.evaluate(
        ([name, request]) => window[name].acquire(request),
        [
          AGENT,
          {
            subjectId: planned.subject.id,
            viewport,
            engine,
            fonts: config.fonts,
            roots: ['#storybook-root', '#root'],
          },
        ],
      );

      const { document, capture } = JSON.parse(raw);

      return {
        ok: true,
        document,
        // Normalized here rather than in the page: the ruleset is the same one
        // the jsdom path uses, and running it in the browser would make the two
        // profiles two implementations of it.
        snapshot: normalize(capture),
        source,
        // No `causes`. Naming the roots of a change needs the *previous*
        // snapshot, and a durable run has a baseline image without one — the
        // same gap `cases/incumbent-case` measures from the other end when it
        // imports a foreign baseline. Ranking falls back to area, which
        // `rankRegions` documents as honest and not good.
      };
    },

    async close() {
      await browser.close();
      // `close` alone waits for open connections to drain, and a browser that
      // has just been killed does not always get to send its FIN — so the
      // callback never fires and a run that produced a correct report hangs on
      // exit. The sockets are ours and the browser is gone; ending them is not a
      // race with anything.
      started.server.closeAllConnections();
      await new Promise((resolve) => started.server.close(resolve));
    },
  };
}
