// compass: variance-authority.reach.story

/**
 * The note a story writes where a page's top frame loaded a document: the
 * address without its query or fragment, and `reloaded` in place of
 * `navigated` where the engine says the load was a reload. The verdict comes
 * before the address, so a note cut to fit still says it.
 */
export function navigationNote(url: string, reload: boolean): string {
  return `page ${reload ? 'reloaded' : 'navigated'} ${url.split(/[?#]/)[0]}`;
}
