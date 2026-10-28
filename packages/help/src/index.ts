/**
 * `@variance-authority/help` — what a workspace publishes, answered on demand.
 *
 * A library is used by somebody who has not read it, and increasingly by
 * something that cannot. What both need is not the README: it is which names
 * exist, which of them anybody actually reaches for, what each one's signature
 * is, and what was written above it. All four are readable off the same disk the
 * code is on, and none of them requires a build, a doc site, or a step somebody
 * remembers to run.
 *
 * Three parts, and the split is the design:
 *
 * - The reading is [`@variance-authority/package`](https://variance-authority.dev/reference/packages/package), which owns every
 *   decision about what a workspace publishes and what reaches for it. Nothing
 *   here re-derives any of it.
 * - The framing is [`@variance-authority/mcp`](https://variance-authority.dev/reference/packages/mcp), whose protocol half is
 *   generic in what it serves. A JSON-RPC line is a JSON-RPC line whether the
 *   subject is a visual-difference report or an API.
 * - What is left, and what is in this package, is the five questions worth
 *   asking and the words the answers are written in.
 *
 * ## Why this is not a documentation generator
 *
 * A generator renders everything a package exports, equally. This ranks, and it
 * ranks on a fact rather than on a heuristic: how many packages in the repository
 * import the name. That single number turns a thousand exports into a front door
 * and a footnote, and it turns *61% of names are documented* — which nobody acts
 * on — into a list of the names that are silent in front of an audience.
 */

export {
  publishedGeneration,
  readWorkspace,
  readWorkspaceForAnswer,
  readWorkspaceSnapshot,
  refreshWorkspace,
  workspaceGeneration,
  workspaceSnapshotPath,
} from './read.js';
export type { AnsweringOptions, ReadingOptions, SnapshotOptions } from './read.js';
export { publishWorkspaceFromIndex, type FromIndexOptions } from './refresh-native.js';
export { readNamedTree, type NamedTree } from './names-read.js';
export { countingShown, readSearchForAnswer, unopenedLine, type SearchReading, type ShownCounting, type Unopened, type ValueRead } from './search-read.js';
export type { SearchIndex } from './search-index.js';
export { serveWorkspace } from './server.js';
export type { WorkspaceOptions } from './server.js';
export { wordsOf } from './words.js';
export { writePages } from './write.js';
export type { PagesOptions, Written } from './write.js';
export { refreshDependencyLexicon } from './dependency-lexicon.js';
export { caughtUp, foundNothingAnswer, foundNothingFooter, snapshotLine, type CaughtUp } from './caught-up.js';
export { FoundNothing } from './tools/find.js';
