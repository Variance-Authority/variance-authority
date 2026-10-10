import type { Intervention, PageGlobals } from './intervention.js';

/**
 * The two tricks that block until something outside the page has landed.
 *
 * Apart from [`stabilize.ts`](./stabilize.ts) because they are the tricks with
 * the most page-side code: each ships a closure into the page, bounds its wait at
 * 15000ms and names what never answered. The rest of the vocabulary is a line of
 * CSS or a screenshot option.
 */

export const waitForFonts: Intervention = {
  id: 'wait-for-fonts',
  trick: 'wait',
  needs: 'layout',
  governs: 'fonts',
  because: 'waited for web fonts, whose advances change every metric on the page',
  // Written without a module-scope helper on purpose: a settle closure is
  // shipped to a page as source text, so anything it names by identifier is a
  // `ReferenceError` on the far side. Types are erased and therefore free.
  settle: async (target) => {
    await target.evaluate(async () => {
      const view = globalThis as unknown as PageGlobals;
      const fonts = view.document.fonts;
      if (fonts === undefined) return;
      // Bounded as `waitForImages` is: a font request that never answers neither
      // loads nor fails, so `ready` never settles. Refused at the same 15000ms,
      // naming each face still loading by family and the source its rule asked for.
      let timer: unknown;
      const expired = new Promise<never>((_, reject) => {
        timer = view.setTimeout(() => {
          const unquoted = (family: string): string => family.trim().replace(/^(["'])(.*)\1$/, '$2');
          const sources = new Map<string, string[]>();
          type Rules = PageGlobals['document']['styleSheets'][number]['cssRules'];
          const visit = (rules: Rules): void => {
            for (const rule of Array.from(rules)) {
              if (rule.cssRules !== undefined) visit(rule.cssRules);
              // Only a `@font-face` rule carries `src`; a style rule reads empty.
              const source = rule.style?.getPropertyValue('src') ?? '';
              if (source === '') continue;
              const family = unquoted(rule.style!.getPropertyValue('font-family'));
              sources.set(family, [...(sources.get(family) ?? []), source]);
            }
          };
          for (const sheet of Array.from(view.document.styleSheets)) {
            try {
              visit(sheet.cssRules);
            } catch {
              // A cross-origin sheet hides its rules; its faces are named by family alone.
            }
          }
          const stuck = Array.from(fonts).filter((face) => face.status === 'loading');
          const named = stuck.map((face) => {
            const asked = sources.get(unquoted(face.family));
            return asked === undefined ? face.family : `${face.family} from ${asked.join(' or ')}`;
          });
          reject(
            new Error(
              `${stuck.length} web font(s) had not loaded after 15000ms, and neither answered ` +
                `nor failed: ${named.join('; ')}`,
            ),
          );
        }, 15000);
      });
      try {
        await Promise.race([fonts.ready, expired]);
      } finally {
        view.clearTimeout(timer);
      }
    });
  },
};

export const waitForImages: Intervention = {
  id: 'wait-for-images',
  trick: 'wait',
  needs: 'layout',
  governs: 'images',
  because:
    'waited for images to decode, since their intrinsic size participates in layout, and asked ' +
    'for the ones the browser had deferred',
  settle: async (target) => {
    await target.evaluate(async () => {
      const view = globalThis as unknown as PageGlobals;
      const pending = Array.from(view.document.images).filter((image) => !image.complete);

      const arrived = Promise.all(
        pending.map(
          (image) =>
            new Promise<void>((resolve) => {
              image.addEventListener('load', () => resolve(), { once: true });
              image.addEventListener('error', () => resolve(), { once: true });
            }),
        ),
      );

      // Asked for, after the listeners are attached and before anything is
      // awaited. A `loading="lazy"` image outside the viewport has not been
      // requested and will not be until something scrolls, so waiting on it is
      // waiting for a decision the browser has already taken the other way.
      //
      // This is the same act as pinning an animation, not a different kind of
      // thing: what the page shows stops depending on where the viewport
      // happens to be. It matters most for the readings that need it most — a
      // full-page capture of a long page is exactly the case where most of the
      // images are deferred, and photographing it without them yields a picture
      // full of empty boxes whose contents change with the browser's loading
      // heuristics rather than with the product.
      const asServed = pending.map((image) => image.loading);
      for (const image of pending) image.loading = 'eager';

      // Bounded, and it throws when the bound is reached.
      //
      // A response can stall: a CDN that never answers, an image endpoint that
      // deadlocks under its own concurrency, an image the browser deferred and
      // will not request from where the page is scrolled. None of those fire
      // `load` and none fire `error`, so an unbounded wait turns one stuck
      // request into a run that never ends and never says why — not a wrong
      // answer, no answer.
      //
      // Giving up quietly would be worse than the hang in a subtler way: it
      // photographs a page with holes in it and reports the holes as a change,
      // inventing a regression out of the network this trick exists to hold
      // still. Refused instead, naming what it was still waiting for, because
      // "these two never answered" is a finding about the application.
      //
      // The bound is written twice — once as the delay, once in the sentence —
      // because a settle closure is shipped to the page as source text and a
      // constant it named would be a `ReferenceError` on the far side.
      // Held so the loser can be cancelled. A timer left to fire after the
      // images arrived rejects a promise nothing is waiting on any more, which
      // the page reports as an unhandled rejection — this trick's own noise,
      // arriving in the console of every subject it succeeded on.
      let timer: unknown;

      const expired = new Promise<never>((_, reject) => {
        timer = view.setTimeout(() => {
          const stuck = pending.filter((image) => !image.complete);
          reject(
            new Error(
              `${stuck.length} image(s) had not loaded after 15000ms, and neither answered ` +
                `nor failed: ${stuck.map((image) => image.currentSrc || image.src).join(', ')}`,
            ),
          );
        }, 15000);
      });

      try {
        await Promise.race([arrived, expired]);
      } finally {
        view.clearTimeout(timer);

        // Put back, because the trick has to be invisible to the tier that
        // reads the page after it. `loading` is a reflected attribute, so a
        // document whose deferred images were switched to `eager` and left that
        // way is a document that no longer matches the one the product served —
        // and which images were still undecoded when this ran is a question
        // about the network, so the edit lands in some readings and not others.
        // Left in, it makes the same page at two widths disagree about its own
        // markup: this trick filed as a finding against the application.
        for (let index = 0; index < pending.length; index += 1) {
          pending[index]!.loading = asServed[index]!;
        }
      }
    });
  },
};
