import type { ReviewConfig } from '../config.js';

/**
 * The question a push asks before it sends, and the address it asks at.
 *
 * Apart from [`push.ts`](./push.ts) because this is the half that may fail
 * without anybody hearing about it. Everything here is an optimisation: it is
 * allowed to answer "I do not know", and the push it leaves behind is the push
 * that existed before this route did. A file where every failure is silent is
 * one to read in isolation, with that rule stated once at the top of it.
 */

/**
 * Of the images this push is holding, which the deployment can already produce.
 *
 * The payoff of content-addressed objects, collected in one request. A run's
 * `before` is the baseline the deployment handed it over `/baseline/find`, so it
 * is always a hit; an unchanged subject's `after` is a second copy of that same
 * baseline; and a suite where most subjects did not move sends the report and
 * almost no pixels. Asked once for the whole build rather than per subject,
 * because the cost being avoided is round trips as much as bytes.
 *
 * ## Every failure here is silent and sends everything
 *
 * A deployment older than this route answers 404, one behind a proxy that eats
 * POSTs answers something else, and a network that drops throws. All three mean
 * the same thing — *this push does not know what is already there* — and the
 * safe reading of not knowing is that nothing is. The push is then exactly the
 * push it was before this route existed: larger, slower, correct. Turning a
 * missing optimisation into a failed build would make upgrading the CLI ahead of
 * the deployment a breaking change, which is the one thing a client-side
 * optimisation must never be.
 */
export async function alreadyHeld(
  send: typeof globalThis.fetch,
  review: ReviewConfig,
  digests: readonly string[],
): Promise<ReadonlySet<string>> {
  if (digests.length === 0) return new Set();

  const held = new Set<string>();
  for (let at = 0; at < digests.length; at += MAX_HAVE_DIGESTS) {
    const batch = digests.slice(at, at + MAX_HAVE_DIGESTS);
    let answered: unknown;
    try {
      const response = await send(`${endpointOf(review)}/review/have`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${review.token()}`,
        },
        body: JSON.stringify({ digests: batch }),
      });
      if (!response.ok) return held;
      answered = await response.json();
    } catch {
      return held;
    }

    const list = (answered as { have?: unknown } | null)?.have;
    if (!Array.isArray(list)) return held;
    for (const digest of list) if (typeof digest === 'string') held.add(digest);
  }
  return held;
}

/**
 * How many digests one question may name.
 *
 * The deployment's own cap, restated rather than imported: this package does not
 * depend on `@variance-authority/tribunal`, and a CLI that could only talk to a
 * service it compiles against would be a CLI nobody can deploy independently. A
 * client splitting more finely than the service requires is harmless; the
 * service refuses a longer list rather than trimming it, so a drift in this
 * direction is loud.
 */
const MAX_HAVE_DIGESTS = 1000;

export function endpointOf(review: ReviewConfig): string {
  return review.endpoint.replace(/\/$/, '');
}
