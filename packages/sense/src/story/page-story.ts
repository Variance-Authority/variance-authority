// compass: variance-authority.reach.story
/**
 * What a page that tapes and the collector it runs agree on, apart from the
 * tap: the collector reads these, and loads nothing of the story to do it.
 */

import type { ModuleId } from '../instrument/index.js';

/** Where a page keeps the maker `storyPageSource` installs. */
export const PAGE_STORY = 'variance-authority.story.page';

/** One page's tape between two drains, as the page collector hands it over. */
export interface PageStory {
  readonly tape: readonly number[];
  readonly taped: number;
  readonly visits: number;
  /** Each note: how many visits were taped before it, and the text. */
  readonly notes: readonly (readonly [at: number, text: string])[];
  /** Each test line a statement the page ran was cut at: how many visits were taped before it, and the line. */
  readonly lines: readonly (readonly [at: number, line: number, said: number])[];
  readonly unnoted: number;
  /** What each module held when it ran, kept from the first drain on. */
  readonly held: readonly (readonly [ModuleId, string])[];
  readonly rows: { readonly ids: readonly ModuleId[]; readonly counts: readonly number[]; readonly bases: readonly number[] };
}
