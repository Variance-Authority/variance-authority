import {
  digestBytes,
  type Diagnostic,
  type Digest,
  type RenderResource,
} from '@variance-authority/core/format';
import type { Page } from 'playwright';
import {
  type BlankRule,
  blankKey,
  blankPng,
  blankRuleError,
  blankRuleFor,
  blankUrlAimedAt,
  imageSize,
} from './blank.js';
import { freezeGif, isGifResponse } from './gif.js';
import { type Paused, pauseByProtocol, pauseByRoute } from './pause.js';
import { isSpeculative } from './speculative.js';

/**
 * The wire as an observation, not just a transport.
 *
 * ## The hole this closes
 *
 * `EnvironmentInputs.assets` has existed since the format did, documented as
 * "external assets keyed by request URL, valued by content hash", with the
 * warning that an uncovered input "produces two different renders under one key,
 * which is a false `unchanged`". It was a parameter threaded through four
 * packages and **filled by nobody**. Every run in this repository's history has
 * hashed an empty object.
 *
 * So a logo re-exported at a different compression, a hero image swapped behind
 * a CDN path, a font file replaced under the same URL — each produces a
 * different picture under an identical environment key, and the run says
 * `unchanged`. That is the one failure mode this product exists to prevent, and
 * it was open the whole time because the field that closes it had no source.
 *
 * A page cannot supply it. `document.images` gives URLs, not bytes, and reading
 * the bytes back needs a fetch the browser has already made and a CORS grant it
 * probably does not have. **The driver can**, because every byte the page
 * receives passes through it.
 *
 * ## The second thing the wire knows
 *
 * `wait-for-images` polls `document.images` once and waits for what it finds.
 * That misses an image appended while the wait is running, a `background-image`
 * (which has no load event at all), and a `srcset` candidate the browser
 * re-resolves after a viewport change. Every one of those is invisible from
 * inside the page and obvious from here: this saw the request.
 *
 * So {@link NetworkObservation.settle} is the honest version of "the images have
 * loaded" — not a poll over the nodes that existed at one moment, but a count of
 * what has been asked for and not yet answered.
 *
 * ## What it costs, stated plainly
 *
 * Every held request makes a round trip into Node, and Playwright's routing
 * turns the HTTP cache off unless {@link NetworkOptions.cache} asks otherwise.
 * So only asset requests are fetched and hashed; everything else is continued
 * without being read, which is one IPC hop and no body. Documents, scripts and
 * stylesheets are deliberately not hashed: their effect on the render arrives
 * through the capture itself — the DOM, the rule text — and hashing them would
 * pay for a second copy of something already covered.
 */

/** Resource types whose *bytes* change the render without entering the capture. */
const HASHED_TYPES: ReadonlySet<string> = new Set(['image', 'font', 'media']);

/**
 * What a collector decides about the wire, and every default it can move.
 *
 * A value rather than a set of arguments because a collector that can open a
 * second world has to open both from the same one. `collectAlone` asks whether a
 * subject differs because another subject ran first, and the only reading that
 * answers it is one where isolation is the *only* difference — so the two worlds
 * share this object, and a hash setting or a blanking rule that drifted between
 * them would come back looking exactly like the pollution being hunted.
 *
 * Every field is a position rather than a preference: each one is either in the
 * environment key or in what the page was served, so changing it makes a
 * baseline read against a different recipe.
 */
export interface NetworkOptions {
  /**
   * Serve animated GIFs as their first frame. Defaults to `true`.
   *
   * See [`gif.ts`](gif.ts) for why doing this on the wire beats doing it in the
   * page, and `docs/stabilization.md` for what it is one of.
   */
  readonly freezeAnimatedImages?: boolean;

  /**
   * Hash asset bodies into {@link NetworkObservation.assets}. Defaults to `true`.
   *
   * Off is a real position for a page whose assets are content-addressed already
   * — a URL that contains its own hash is an identity, and hashing the bytes
   * again buys nothing but the read.
   */
  readonly hashAssets?: boolean;

  /**
   * Bytes above which an asset is recorded by size rather than by content.
   * Defaults to 8 MiB.
   *
   * A ceiling rather than a cliff: a video that would cost more to hash than to
   * download is recorded as `size:<n>`, which still moves the key when the file
   * moves and says in the value itself that it is the weaker claim. Silently
   * skipping it would leave a hole in the key that nothing announces, and a hole
   * in this key is a false `unchanged`.
   */
  readonly hashCeilingBytes?: number;

  /**
   * Images to serve as nothing, at their own size. Empty by default.
   *
   * The stronger relative of an ignore mask, and the reason it is stronger is
   * that it happens *first*: a mask hides pixels after a page has fetched an
   * image, laid out around it, and moved the environment key with its bytes. See
   * [`blank.ts`](blank.ts) for what it can and cannot decide — in one line, it
   * knows the URL and the intrinsic size, and it does not know the DOM.
   */
  readonly blank?: readonly BlankRule[];

  /**
   * Keep the bytes, not just their digest, so the document can be painted
   * somewhere with no route to this origin. Off by default.
   *
   * The read has already happened — every hashed type is fetched and its body
   * held long enough to digest it. This is retention, not acquisition, which is
   * why the portable document costs a map rather than a second crawl.
   *
   * What is kept is what was *served*: the blank an image became, the single
   * frame a GIF was truncated to, the bytes that actually reached the page. The
   * alternative — keeping what arrived — would paint a different picture later
   * than the run that observed it, which is the one thing an archive exists to
   * prevent.
   */
  readonly retainResources?: boolean;

  /**
   * Leave the browser's HTTP cache on. Off by default.
   *
   * On, requests are held through the DevTools protocol instead of Playwright's
   * routing, which turns the cache off: a page whose context another page
   * already filled is answered from it, and every answer still passes here. An
   * image the same page already shows does not — it is drawn again without a
   * request — so only a caller that never calls `reset` may turn this on.
   * Chromium only; see `pause.ts`.
   */
  readonly cache?: boolean;
}

export interface NetworkObservation {
  /** `EnvironmentInputs.assets`: request URL to content digest. */
  readonly assets: Readonly<Record<string, Digest | string>>;

  /** URLs served as a single frame. Empty is the expected case. */
  readonly frozen: readonly string[];

  /**
   * Images served as nothing, and which rule did it.
   *
   * A ledger rather than a count, because blanking is the one intervention here
   * that can hide a real regression: an operator who blanked more than they meant
   * to needs to be able to read back exactly what disappeared, per subject,
   * without re-running with the feature off.
   */
  readonly blanked: readonly BlankedAsset[];

  /** Anything it could not do. Never a thrown error — see {@link observeNetwork}. */
  readonly diagnostics: readonly Diagnostic[];

  /**
   * Whether what was served can be handed to a renderer with no route to this
   * origin, and the bytes if it can.
   *
   * A result rather than a map, because "portable" is a claim that can fail and
   * the failure has to arrive at capture, holding the URLs, while the operator
   * is still standing next to the page that produced them. Discovering it at
   * render time means discovering it on a different machine, in a different
   * process, from a digest mismatch — the same fact, arriving where nobody can
   * act on it.
   *
   * Always `ok: false` when {@link NetworkOptions.retainResources} is off: no
   * bytes were kept, so nothing can be claimed.
   */
  closure(): ResourceClosure;

  /**
   * Resolve when no image, font or media request is in flight, or say which are.
   *
   * Resolves `undefined` once the last one is answered. At `timeoutMs` with any
   * still open it resolves the refusal instead, naming them: a subject read
   * without its image records bytes nobody hashed, and the caller refuses it
   * rather than read it. Only asset requests count, so a long-poll never holds
   * it open, and only those started since the last settle or reset, so an
   * earlier subject's stall — named in that subject's refusal — never does.
   */
  settle(timeoutMs?: number): Promise<string | undefined>;

  /**
   * Forget what has been observed, for the page that is about to be loaded.
   *
   * The observation is per *page*, as a request carries no idea which subject
   * will use it. A caller navigating per subject resets per navigation and gets
   * exactly its subject's assets. One reusing a page across subjects — a
   * Storybook run — does not, so each subject carries the page's whole set:
   * over-invalidating, the direction to be wrong in.
   */
  reset(): void;

  /** Stop routing. The recorded assets stay readable. */
  close(): Promise<void>;
}

/** One image that was replaced, with enough to find it again. */
/**
 * Either every served resource, or the names of the ones that stop the claim.
 *
 * `unresolved` carries a reason per URL rather than a bare list. An operator
 * reading "could not close 3 resources" has to go and find out why; the same
 * operator reading that a video is past the hash ceiling and two fonts were
 * never observed already knows which lever each one needs.
 */
export type ResourceClosure =
  | { readonly ok: true; readonly resources: Readonly<Record<string, RenderResource>> }
  | { readonly ok: false; readonly unresolved: readonly string[] };

export interface BlankedAsset {
  readonly url: string;
  /** {@link BlankRule.id} of the rule that matched. */
  readonly rule: string;
  readonly width: number;
  readonly height: number;
}

const DEFAULT_CEILING_BYTES = 8 * 1024 * 1024;
const DEFAULT_SETTLE_MS = 5_000;

/**
 * Watch and, where it helps, rewrite what a page is served.
 *
 * **Nothing here may fail a page load.** Every branch that could throw ends in
 * the request continuing unmodified with a diagnostic recorded, because a
 * stabilizer that can take down the page it was stabilizing is worse than the
 * flake it prevents. The diagnostics are the difference between that policy and
 * silence.
 */
export async function observeNetwork(
  page: Page,
  options: NetworkOptions = {},
): Promise<NetworkObservation> {
  const freeze = options.freezeAnimatedImages ?? true;
  const hash = options.hashAssets ?? true;
  const ceiling = options.hashCeilingBytes ?? DEFAULT_CEILING_BYTES;
  const blankRules = options.blank ?? [];

  // Before anything is routed, and therefore not a page failure: a rule list
  // that cannot mean what it says is refused while the operator is still reading
  // their own config, not turned into a diagnostic under a green run.
  const ruleError = blankRuleError(blankRules);
  if (ruleError !== null) throw new Error(ruleError);

  const retain = options.retainResources ?? false;

  const assets: Record<string, string> = {};
  const frozen: string[] = [];
  const blanked: BlankedAsset[] = [];
  const diagnostics: Diagnostic[] = [];
  // This subject's open requests, counted per URL as two may share one.
  let inFlight = new Map<string, number>();
  const resources = new Map<string, RenderResource>();
  const unresolved = new Map<string, string>();
  let idle: (() => void) | undefined;

  const unpause = await (options.cache === true
    ? pauseByProtocol(page, handle, (message) => diagnostics.push({ severity: 'warn', code: 'target-not-observed', message }))
    : pauseByRoute(page, handle));

  return {
    assets,
    frozen,
    blanked,
    diagnostics,
    settle,
    closure(): ResourceClosure {
      if (!retain) {
        return {
          ok: false,
          unresolved: ['no resource was retained: observeNetwork ran with retainResources off'],
        };
      }
      if (unresolved.size > 0) {
        return { ok: false, unresolved: [...unresolved.values()].sort() };
      }
      return { ok: true, resources: Object.fromEntries(resources) };
    },
    reset(): void {
      for (const url of Object.keys(assets)) delete assets[url];
      frozen.length = 0;
      blanked.length = 0;
      // Cleared with the rest. `reset` marks the boundary between subjects, and a
      // resource carried across it would close one subject's document over bytes
      // another subject's page fetched.
      resources.clear();
      unresolved.clear();
      inFlight = new Map();
    },
    async close(): Promise<void> {
      await unpause();
    },
  };

  async function handle(request: Paused): Promise<void> {
    const { url } = request;

    // Refused before it leaves. What the page guesses it will show next is not
    // what it shows: served, a prefetch renders another page's code on this
    // page's behalf, and when it happens depends on what scrolled into view.
    if (isSpeculative(request.headers)) {
      await request.abort().catch(noteRouteFailure(url));
      return;
    }

    // Continued without a body read. A script or a document affects the render
    // through the capture, which already has it; paying to hash one here would
    // buy a second copy of a covered input.
    if (
      !HASHED_TYPES.has(request.resourceType) ||
      (!hash && !freeze && blankRules.length === 0)
    ) {
      await request.continue().catch(noteRouteFailure(url));
      return;
    }

    const open = inFlight;
    open.set(url, (open.get(url) ?? 0) + 1);

    try {
      const response = await request.fetch();
      if (response === null) return;
      const { body, headers } = response;

      if (request.resourceType === 'image' && (await serveBlank(request, url, body))) return;

      if (hash) assets[url] = digestOf(body, ceiling);

      const still = freeze && isGifResponse(headers, url) ? freezeGif(body) : null;

      if (still !== null) {
        frozen.push(url);
        // The frame, not the film. Retaining the original would hand a later
        // renderer an animation this run had already stopped.
        keep(url, still, headers['content-type'] ?? 'image/gif');
        await response.fulfill(still);
      } else {
        keep(url, body, headers['content-type'] ?? 'application/octet-stream');
        await response.pass();
      }
    } catch (error) {
      // The request may already be gone — a navigation cancels everything it
      // started — so continuing is itself allowed to fail.
      diagnostics.push({
        severity: 'warn',
        code: 'asset-not-observed',
        message:
          `could not read ${url}, so its bytes are absent from the environment key: ` +
          messageOf(error),
      });
      // A warning for the environment key, but a refusal for portability: the
      // key can survive one unread asset as a weaker claim, and an archive that
      // is missing one cannot be painted at all.
      unresolved.set(url, `${url} could not be read: ${messageOf(error)}`);
      await request.continue().catch(noteRouteFailure(url));
    } finally {
      if (open.get(url) === 1) open.delete(url);
      else open.set(url, open.get(url)! - 1);
      if (open === inFlight && open.size === 0) idle?.();
    }
  }

  /**
   * Replace this image with nothing, and say so — or leave it alone.
   *
   * Returns whether the route was fulfilled, so the caller can skip hashing: a
   * blanked asset is recorded as *the blank it became*, never as the bytes it
   * arrived as. That is the saving. Hashing the original as well would put the
   * discarded bytes back into the environment key and re-render every subject
   * the image appears on to rediscover that it had been thrown away.
   */
  async function serveBlank(request: Paused, url: string, body: Buffer): Promise<boolean> {
    if (blankRules.length === 0) return false;

    const size = imageSize(body);
    if (size === null) {
      // Only worth a diagnostic when a rule was actually aimed at this URL.
      // Every page has an SVG this cannot measure, and a warning for each one
      // would bury the case that matters: a rule that looks applied and is not.
      if (blankUrlAimedAt(blankRules, url)) {
        diagnostics.push({
          severity: 'warn',
          code: 'blank-size-unknown',
          message:
            `${url} matched a blank rule by URL, but its intrinsic size is not readable from ` +
            'its header, so it was served unmodified rather than at a guessed size',
        });
      }
      return false;
    }

    const rule = blankRuleFor(blankRules, url, size);
    if (rule === null) return false;

    assets[url] = blankKey(rule, size);
    blanked.push({ url, rule: rule.id, width: size.width, height: size.height });

    // The blank it became, for the same reason the key records the blank: a
    // later render that fetched the real image back would disagree with the
    // capture about pixels the operator deliberately removed.
    const blank = blankPng(size.width, size.height);
    keep(url, blank, 'image/png');

    await request.serve('image/png', blank);
    return true;
  }

  /**
   * Hold the bytes that were served, or record why this URL cannot be closed.
   *
   * The ceiling is the interesting case. `assets` may record a large file as
   * `size:<n>` and stay useful, because a size still moves when the file moves.
   * An archive cannot: the renderer verifies each resource against a content
   * digest before painting, so a `size:` claim would be a resource that fails
   * verification on arrival. It refuses here instead, while the URL still means
   * something to whoever is reading.
   */
  function keep(url: string, body: Uint8Array, contentType: string): void {
    if (!retain) return;

    if (body.length > ceiling) {
      unresolved.set(
        url,
        `${url} is ${body.length} bytes, past the ${ceiling}-byte ceiling, so it is recorded ` +
          'by size and cannot be closed over by content',
      );
      return;
    }

    resources.set(url, {
      contentType,
      bytes: Buffer.from(body).toString('base64'),
      digest: digestBytes(body),
    });
  }

  async function settle(timeoutMs = DEFAULT_SETTLE_MS): Promise<string | undefined> {
    if (inFlight.size === 0) return undefined;

    const outstanding = await new Promise<readonly string[]>((resolve) => {
      const timer = setTimeout(() => resolve([...inFlight.keys()]), timeoutMs);
      idle = (): void => (clearTimeout(timer), resolve([]));
    });
    idle = undefined;
    inFlight = new Map();
    if (outstanding.length === 0) return undefined;

    const requests = `${outstanding.length} image, font or media request${outstanding.length === 1 ? '' : 's'}`;
    return (
      `${requests} had no answer after ${timeoutMs}ms, so the subject was not read: ` +
      `${outstanding.slice(0, 5).join(', ')}` +
      (outstanding.length > 5 ? ` and ${outstanding.length - 5} more` : '')
    );
  }

  function noteRouteFailure(url: string) {
    return (error: unknown): void => {
      diagnostics.push({
        severity: 'warn',
        code: 'request-not-continued',
        message: `${url} could not be continued: ${messageOf(error)}`,
      });
    };
  }
}

/**
 * A digest, or a size when the file is past the ceiling.
 *
 * The two are told apart by their own shape — `v1:…` against `size:…` — so a
 * reader of an environment diff can see which claim they are looking at without
 * being told separately.
 */
function digestOf(body: Uint8Array, ceiling: number): string {
  return body.length > ceiling ? `size:${body.length}` : digestBytes(body);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
