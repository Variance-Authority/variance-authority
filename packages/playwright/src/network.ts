import { digestBytes, type Diagnostic, type Digest } from '@variance-authority/core';
import type { Page, Route } from 'playwright';
import {
  type BlankRule,
  blankKey,
  blankPng,
  blankRuleError,
  blankRuleFor,
  blankUrlAimedAt,
  imageSize,
} from './blank.js';
import { freezeGif } from './gif.js';

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
 * Routing disables the browser's HTTP cache for what it routes, and every routed
 * request makes a round trip into Node. So only asset requests are fetched and
 * hashed; everything else is continued without being read, which is one IPC hop
 * and no body. Documents, scripts and stylesheets are deliberately not hashed:
 * their effect on the render arrives through the capture itself — the DOM, the
 * rule text — and hashing them would pay for a second copy of something already
 * covered.
 */

/** Resource types whose *bytes* change the render without entering the capture. */
const HASHED_TYPES: ReadonlySet<string> = new Set(['image', 'font', 'media']);

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
   * Resolve when nothing is in flight, or report what is still outstanding.
   *
   * Never throws on timeout. A page with a long-poll open would otherwise fail a
   * run for being a normal page, so the outstanding URLs become a diagnostic and
   * the subject is read anyway — and the diagnostic is on the record, which is
   * what the reader of a surprising diff needs.
   */
  settle(timeoutMs?: number): Promise<void>;

  /**
   * Forget what has been observed, for the page that is about to be loaded.
   *
   * The observation is per *page*, not per subject, because that is what the
   * wire can see: a request carries no idea which subject will end up using it.
   * A caller that navigates per subject resets per navigation and gets an asset
   * set that is exactly its subject's. A caller reusing one page across many
   * subjects — a Storybook run — does not, and every subject there carries the
   * page's whole asset set, which over-invalidates rather than under-invalidates
   * and is the direction to be wrong in.
   */
  reset(): void;

  /** Stop routing. The recorded assets stay readable. */
  close(): Promise<void>;
}

/** One image that was replaced, with enough to find it again. */
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

  const assets: Record<string, string> = {};
  const frozen: string[] = [];
  const blanked: BlankedAsset[] = [];
  const diagnostics: Diagnostic[] = [];
  const inFlight = new Set<string>();
  let idle: (() => void) | undefined;

  await page.route('**/*', handle);

  return {
    assets,
    frozen,
    blanked,
    diagnostics,
    settle,
    reset(): void {
      for (const url of Object.keys(assets)) delete assets[url];
      frozen.length = 0;
      blanked.length = 0;
    },
    async close(): Promise<void> {
      await page.unroute('**/*', handle);
    },
  };

  async function handle(route: Route): Promise<void> {
    const request = route.request();
    const url = request.url();

    // Continued without a body read. A script or a document affects the render
    // through the capture, which already has it; paying to hash one here would
    // buy a second copy of a covered input.
    if (
      !HASHED_TYPES.has(request.resourceType()) ||
      (!hash && !freeze && blankRules.length === 0)
    ) {
      await route.continue().catch(noteRouteFailure(url));
      return;
    }

    inFlight.add(url);

    try {
      const response = await route.fetch();
      const body = await response.body();

      if (request.resourceType() === 'image' && (await serveBlank(route, url, body))) return;

      if (hash) assets[url] = digestOf(body, ceiling);

      const still = freeze && isGifResponse(response.headers(), url) ? freezeGif(body) : null;

      if (still !== null) {
        frozen.push(url);
        await route.fulfill({ response, body: Buffer.from(still) });
      } else {
        await route.fulfill({ response, body: Buffer.from(body) });
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
      await route.continue().catch(noteRouteFailure(url));
    } finally {
      inFlight.delete(url);
      if (inFlight.size === 0) idle?.();
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
  async function serveBlank(route: Route, url: string, body: Buffer): Promise<boolean> {
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

    await route.fulfill({
      status: 200,
      contentType: 'image/png',
      body: blankPng(size.width, size.height),
    });
    return true;
  }

  async function settle(timeoutMs = DEFAULT_SETTLE_MS): Promise<void> {
    if (inFlight.size === 0) return;

    const outstanding = await new Promise<readonly string[]>((resolve) => {
      const timer = setTimeout(() => resolve([...inFlight]), timeoutMs);
      idle = (): void => {
        clearTimeout(timer);
        resolve([]);
      };
    });

    idle = undefined;
    if (outstanding.length === 0) return;

    diagnostics.push({
      severity: 'warn',
      code: 'network-not-quiet',
      message:
        `${outstanding.length} request(s) were still in flight after ${timeoutMs}ms and the ` +
        `subject was read anyway: ${outstanding.slice(0, 5).join(', ')}`,
    });
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

/**
 * Whether a response is a GIF, by header first and extension second.
 *
 * Content type is what the browser will believe, so it decides. The extension is
 * a fallback for a server that sends `application/octet-stream` — common enough
 * on object storage — and never an override, because a `.gif` served as `png` is
 * a PNG to every decoder that matters.
 */
function isGifResponse(headers: Readonly<Record<string, string>>, url: string): boolean {
  const type = headers['content-type'];
  if (type !== undefined && type.length > 0) return type.toLowerCase().includes('image/gif');
  return /\.gif(?:[?#]|$)/i.test(url);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
