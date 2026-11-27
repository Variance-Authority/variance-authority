/**
 * Requests nothing a render waits on is carried by.
 *
 * A channel stays open for as long as the page does, so counting one would make
 * every page that holds one look as though something were still arriving; a
 * media element is one too, streaming for as long as it plays. A font or an
 * image is an asset: React neither hydrates nor creates a root on one, and the
 * stages that read assets wait for each and name the one that never answers.
 * Counting a stalled font here would hold the wait ahead of the stage that says
 * which font it was.
 */
const NOT_AWAITED: ReadonlySet<string> = new Set(['eventsource', 'font', 'image', 'media', 'websocket']);

/**
 * Whether `request` can carry what a render or an answer waits on: not a
 * channel, a stream or an asset. Read by every package that tells a page's
 * pending work from its requests, so they never disagree on what counts. A
 * Playwright story names the same requests on its lines, so a kind added here
 * leaves those notes too.
 */
export function awaitedRequest(request: { resourceType(): string }): boolean {
  return !NOT_AWAITED.has(request.resourceType());
}
